import { randomUUID } from "node:crypto";
import { researchAcrossSources } from "@/lib/discovery";
import { researchCompany } from "@/lib/company-intelligence";
import { lookupFccAvailability } from "@/lib/fcc";
import { googleMapsBlockedSince, googleMapsCoolingDown } from "@/lib/google-maps-scraper";
import { isServerlessFilesystem } from "@/lib/writable-store";
import { addDiscovery, discoveryIndex, rankSwarmProspect, type DiscoveryIndex } from "@/lib/swarm/logic";
import { listSwarmBatches, mutateSwarm, writeSwarm } from "@/lib/swarm/store";
import type { SwarmAddress, SwarmBatch, SwarmProspect } from "@/lib/swarm/types";
import type { CompanyIntelligence, FccLookupResponse, Prospect, ResearchResponse } from "@/lib/types";

const BUSY = new Set(["queued", "scanning", "qualifying", "researching"]);
export function swarmPending(batch: Pick<SwarmBatch, "status" | "archivedAt">) { return !batch.archivedAt && BUSY.has(batch.status); }
export async function createSwarm(addresses: string[], radiusMiles: number, title?: string) {
  const now = new Date().toISOString();
  const batch: SwarmBatch = { id: randomUUID(), title: title?.trim().slice(0, 100) || `${addresses.length} addresses · ${addresses[0]}`, createdAt: now, updatedAt: now, status: "queued", radiusMiles, addresses: addresses.map((text) => ({ id: randomUUID(), text, status: "pending", coordinates: null, discovered: 0, error: null })), prospects: [], lease: null, leaseUntil: null, warnings: [] };
  await writeSwarm(batch); return batch;
}
async function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Source timed out. Retry this item to check again.")), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
type Providers = { discover: (address: string, radius: number) => Promise<ResearchResponse>; broadband: (p: Prospect) => Promise<FccLookupResponse>; research: (p: Prospect) => Promise<CompanyIntelligence> };
const providers: Providers = { discover: researchAcrossSources, broadband: (p) => lookupFccAvailability({ address: p.address, coordinates: p.coordinates }), research: (p) => researchCompany(p, { businessOnly: true, searchBudgetMs: 30_000 }) };

/** Items in flight per stage. Discovery and research both reach Google, so they never overlap. */
const LANES = { discover: 6, qualify: 12, research: 3 } as const;
type Lane = keyof typeof LANES;
/** Completed work is saved together at most this often, so a large snapshot is not rewritten per item. */
const FLUSH_MS = 1_000;
const HEARTBEAT_MS = 30_000;
const LEASE_MS = 90_000;
const MAX_BLOCKED_RETRIES = 2;
const BLOCKED_WARNING = "Google Maps asked FindBiz to slow down. Results found so far were kept, and the affected addresses will be rechecked after a short pause.";

type Lookup = { index: () => DiscoveryIndex; card: (id: string) => SwarmProspect | undefined; address: (id: string) => SwarmAddress | undefined };
type Change = (batch: SwarmBatch, lookup: Lookup) => void;

function lookupFor(batch: SwarmBatch): Lookup {
  let index: DiscoveryIndex | undefined, cards: Map<string, SwarmProspect> | undefined, addresses: Map<string, SwarmAddress> | undefined;
  return {
    index: () => (index ??= discoveryIndex(batch)),
    // Discovery can append cards after the map is built, so fall back to a scan on a miss.
    card: (id) => (cards ??= new Map(batch.prospects.map((card) => [card.id, card]))).get(id) ?? batch.prospects.find((card) => card.id === id),
    address: (id) => (addresses ??= new Map(batch.addresses.map((address) => [address.id, address]))).get(id),
  };
}
function unfinished(batch: SwarmBatch) {
  return batch.addresses.some((a) => a.status === "pending" || a.status === "scanning")
    || batch.prospects.some((p) => !p.broadbandChecked || p.researchStatus === "queued" || p.researchStatus === "researching");
}
function activeStatus(batch: SwarmBatch): SwarmBatch["status"] {
  if (batch.prospects.some((p) => p.researchStatus === "queued" || p.researchStatus === "researching")) return "researching";
  if (batch.addresses.some((a) => a.status === "pending" || a.status === "scanning")) return "scanning";
  if (batch.prospects.some((p) => !p.broadbandChecked)) return "qualifying";
  return batch.status;
}

/** Rolling parallel discovery, qualification and research, with durable coalesced checkpoints. */
export async function runSwarm(id: string, deps: Providers = providers) {
  const token = randomUUID();
  const claim = await mutateSwarm(id, (batch) => {
    if (!swarmPending(batch) || (batch.lease && Date.parse(batch.leaseUntil ?? '') > Date.now())) return;
    batch.lease = token; batch.leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
    for (const address of batch.addresses) if (address.status === 'scanning') address.status = 'pending';
    for (const prospect of batch.prospects) if (prospect.researchStatus === 'researching') prospect.researchStatus = 'queued';
  });
  if (claim.lease !== token) return;
  const started = Date.now();
  const budgetMs = isServerlessFilesystem() ? 20_000 : 180_000;
  let view = claim, lost = false, lastSave = Date.now(), ping = () => {};
  // An item stays claimed until the save containing its result lands, so it is never started twice.
  const claimed: Record<Lane, Set<string>> = { discover: new Set(), qualify: new Set(), research: new Set() };
  const running: Record<Lane, number> = { discover: 0, qualify: 0, research: 0 };
  const changes: Array<{ apply: Change; release?: [Lane, string] }> = [];

  const save = async (finish?: (batch: SwarmBatch) => void) => {
    const taken = changes.splice(0);
    try {
      view = await mutateSwarm(id, (batch) => {
        if (batch.lease !== token || batch.status === 'paused') { lost = true; return; }
        const lookup = lookupFor(batch);
        for (const change of taken) change.apply(batch, lookup);
        if (finish) finish(batch);
        else { batch.status = activeStatus(batch); batch.leaseUntil = new Date(Date.now() + LEASE_MS).toISOString(); }
      });
    } catch (error) { changes.unshift(...taken); throw error; }
    lastSave = Date.now();
    for (const change of taken) if (change.release) claimed[change.release[0]].delete(change.release[1]);
  };
  const start = (lane: Lane, key: string, work: () => Promise<Change>) => {
    claimed[lane].add(key); running[lane] += 1;
    void work().then((apply) => { changes.push({ apply, release: [lane, key] }); }).finally(() => { running[lane] -= 1; ping(); });
  };

  const launch = () => {
    const researchWaiting = view.prospects.some((p) => p.researchStatus === 'queued' && !claimed.research.has(p.id));
    if (!running.discover) {
      for (const card of view.prospects) {
        if (running.research >= LANES.research) break;
        if (card.researchStatus !== 'queued' || claimed.research.has(card.id)) continue;
        changes.push({ apply: (_, lookup) => { const target = lookup.card(card.id); if (target) target.researchStatus = 'researching'; } });
        start('research', card.id, async () => {
          try {
            const intelligence = await deadline(deps.research(card.business), 60_000);
            return (_, lookup) => { const target = lookup.card(card.id); if (!target) return; target.intelligence = intelligence; target.researchStatus = intelligence.status === 'complete' ? 'complete' : 'partial'; target.updatedAt = new Date().toISOString(); target.error = null; };
          } catch (error) {
            return (_, lookup) => { const target = lookup.card(card.id); if (!target) return; target.researchStatus = 'partial'; target.error = error instanceof Error ? error.message : 'Research unavailable.'; };
          }
        });
      }
    }
    if (!running.research && !researchWaiting && !googleMapsCoolingDown()) {
      for (const address of view.addresses) {
        if (running.discover >= LANES.discover) break;
        if (address.status !== 'pending' || claimed.discover.has(address.id)) continue;
        changes.push({ apply: (_, lookup) => { const target = lookup.address(address.id); if (target) target.status = 'scanning'; } });
        start('discover', address.id, async () => {
          const startedAt = Date.now();
          try {
            const results = await deadline(deps.discover(address.text, view.radiusMiles), 55_000);
            if (results.demoMode) throw new Error('Demo listings are not used in Swarm. Configure real discovery.');
            const blocked = googleMapsBlockedSince(startedAt);
            return (batch, lookup) => {
              const target = lookup.address(address.id); if (!target) return;
              const inside = results.prospects.filter((p) => Number.isFinite(p.distanceMiles) && p.distanceMiles <= batch.radiusMiles);
              target.coordinates = results.target.coordinates; target.discovered = inside.length; target.error = null;
              for (const prospect of inside) addDiscovery(batch, prospect, target.id, randomUUID(), lookup.index());
              const retry = blocked && (target.blockedRetries ?? 0) < MAX_BLOCKED_RETRIES;
              if (retry) target.blockedRetries = (target.blockedRetries ?? 0) + 1;
              target.status = retry ? 'pending' : 'complete';
              batch.warnings = [...new Set([...batch.warnings, ...results.warnings, ...(retry ? [BLOCKED_WARNING] : [])])].slice(-30);
            };
          } catch (error) {
            return (_, lookup) => { const target = lookup.address(address.id); if (!target) return; target.status = 'error'; target.error = error instanceof Error ? error.message : 'Address search failed.'; };
          }
        });
      }
    }
    for (const card of view.prospects) {
      if (running.qualify >= LANES.qualify) break;
      if (card.broadbandChecked || claimed.qualify.has(card.id)) continue;
      start('qualify', card.id, async () => {
        let broadband: FccLookupResponse | null = null;
        let error: string | null = null;
        try { broadband = await deadline(deps.broadband(card.business), 20_000); }
        catch (cause) { error = cause instanceof Error ? cause.message : 'Broadband check unavailable.'; }
        return (_, lookup) => { const target = lookup.card(card.id); if (!target) return; target.broadband = broadband; target.broadbandChecked = true; target.error = error; Object.assign(target, rankSwarmProspect(target)); };
      });
    }
  };

  try {
    while (!lost) {
      const woke = new Promise<void>((resolve) => { ping = resolve; });
      if (Date.now() - started < budgetMs) launch();
      const busy = running.discover + running.qualify + running.research;
      if (!busy) { if (!changes.length) break; await save(); continue; }
      const sinceSave = Date.now() - lastSave;
      if ((changes.length && sinceSave >= FLUSH_MS) || sinceSave >= HEARTBEAT_MS) { await save(); continue; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([woke, new Promise<void>((resolve) => { timer = setTimeout(resolve, (changes.length ? FLUSH_MS : HEARTBEAT_MS) - sinceSave); })]);
      clearTimeout(timer);
    }
    if (lost) return;
    await save((batch) => {
      batch.status = unfinished(batch) ? 'queued' : batch.addresses.every((a) => a.status === 'error') ? 'error' : 'complete';
      batch.lease = null; batch.leaseUntil = null;
    });
  } catch (error) {
    await mutateSwarm(id, (batch) => { if (batch.lease !== token) return; batch.status = 'error'; batch.lease = null; batch.leaseUntil = null; batch.warnings.push(error instanceof Error ? error.message : 'Batch interrupted. Resume to continue.'); });
  }
}
let ticking = false;
export async function tickSwarmWorker() {
  if (ticking) return;
  ticking = true;
  try {
    // Fair scheduling: advance each active batch one bounded slice per tick.
    for (const batch of (await listSwarmBatches()).filter(swarmPending)) await runSwarm(batch.id);
  } finally { ticking = false; }
}
const host = globalThis as typeof globalThis & { swarmWorker?: ReturnType<typeof setInterval> };
export function ensureSwarmWorker() {
  if (isServerlessFilesystem() || host.swarmWorker) return;
  host.swarmWorker = setInterval(() => { void tickSwarmWorker().catch((error) => console.error('Swarm worker:', error)); }, 15_000);
  host.swarmWorker.unref?.();
}
