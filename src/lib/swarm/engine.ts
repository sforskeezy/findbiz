import { randomUUID } from "node:crypto";
import { researchAcrossSources } from "@/lib/discovery";
import { researchCompany } from "@/lib/company-intelligence";
import { lookupFccAvailability } from "@/lib/fcc";
import { isServerlessFilesystem } from "@/lib/writable-store";
import { addDiscovery, rankSwarmProspect } from "@/lib/swarm/logic";
import { listSwarmBatches, mutateSwarm, readSwarm, writeSwarm } from "@/lib/swarm/store";
import type { SwarmBatch } from "@/lib/swarm/types";
import type { CompanyIntelligence, FccLookupResponse, Prospect, ResearchResponse } from "@/lib/types";

const BUSY = new Set(["queued", "scanning", "qualifying", "researching"]);
export function swarmPending(batch: Pick<SwarmBatch, "status">) { return BUSY.has(batch.status); }
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
const providers: Providers = { discover: researchAcrossSources, broadband: (p) => lookupFccAvailability({ address: p.address, coordinates: p.coordinates }), research: (p) => researchCompany(p, { businessOnly: true }) };

/** Three addresses / four profiles at a time, with a persisted checkpoint after each result. */
export async function runSwarm(id: string, deps: Providers = providers) {
  const token = randomUUID();
  let claimed = false;
  await mutateSwarm(id, (batch) => {
    if (!swarmPending(batch) || (batch.lease && Date.parse(batch.leaseUntil ?? '') > Date.now())) return;
    claimed = true; batch.lease = token; batch.leaseUntil = new Date(Date.now() + 300_000).toISOString();
    for (const address of batch.addresses) if (address.status === 'scanning') address.status = 'pending';
    for (const prospect of batch.prospects) if (prospect.researchStatus === 'researching') prospect.researchStatus = 'queued';
  });
  if (!claimed) return;
  const started = Date.now();
  const update = (fn: (batch: SwarmBatch) => void) => mutateSwarm(id, (batch) => { if (batch.lease === token && batch.status !== 'paused') fn(batch); });
  try {
    while (Date.now() - started < 180_000) {
      const batch = await readSwarm(id);
      if (!batch || batch.lease !== token || batch.status === 'paused') return;
      const research = batch.prospects.filter((p) => p.researchStatus === 'queued').slice(0, 3);
      if (research.length) {
        await update((current) => { current.status = 'researching'; for (const p of research) current.prospects.find((item) => item.id === p.id)!.researchStatus = 'researching'; });
        await Promise.all(research.map(async (card) => {
          try {
            const intelligence = await deadline(deps.research(card.business), 40_000);
            await update((current) => { const target = current.prospects.find((p) => p.id === card.id)!; target.intelligence = intelligence; target.researchStatus = intelligence.status === 'complete' ? 'complete' : 'partial'; target.updatedAt = new Date().toISOString(); target.error = null; });
          } catch (error) {
            await update((current) => { const target = current.prospects.find((p) => p.id === card.id)!; target.researchStatus = 'partial'; target.error = error instanceof Error ? error.message : 'Research unavailable.'; });
          }
        }));
        continue;
      }
      const addresses = batch.addresses.filter((item) => item.status === 'pending').slice(0, 3);
      if (addresses.length) {
        await update((current) => { current.status = 'scanning'; for (const item of addresses) current.addresses.find((address) => address.id === item.id)!.status = 'scanning'; });
        await Promise.all(addresses.map(async (address) => {
          try {
            const results = await deadline(deps.discover(address.text, batch.radiusMiles), 55_000);
            if (results.demoMode) throw new Error('Demo listings are not used in Swarm. Configure real discovery.');
            await update((current) => {
              const target = current.addresses.find((item) => item.id === address.id)!;
              const inside = results.prospects.filter((p) => Number.isFinite(p.distanceMiles) && p.distanceMiles <= current.radiusMiles);
              target.status = 'complete'; target.coordinates = results.target.coordinates; target.discovered = inside.length; target.error = null;
              for (const prospect of inside) addDiscovery(current, prospect, target.id, randomUUID());
              current.warnings = [...new Set([...current.warnings, ...results.warnings])].slice(-30);
            });
          } catch (error) {
            await update((current) => { const target = current.addresses.find((item) => item.id === address.id)!; target.status = 'error'; target.error = error instanceof Error ? error.message : 'Address search failed.'; });
          }
        }));
        continue;
      }
      const qualify = batch.prospects.filter((p) => !p.broadbandChecked).slice(0, 4);
      if (qualify.length) {
        await update((current) => { current.status = 'qualifying'; });
        await Promise.all(qualify.map(async (card) => {
          let broadband: FccLookupResponse | null = null;
          let error: string | null = null;
          try { broadband = await deadline(deps.broadband(card.business), 20_000); }
          catch (cause) { error = cause instanceof Error ? cause.message : 'Broadband check unavailable.'; }
          await update((current) => { const target = current.prospects.find((p) => p.id === card.id)!; target.broadband = broadband; target.broadbandChecked = true; target.error = error; Object.assign(target, rankSwarmProspect(target)); });
        }));
        continue;
      }
      await update((current) => { current.status = current.addresses.every((a) => a.status === 'error') ? 'error' : 'complete'; current.lease = null; current.leaseUntil = null; });
      return;
    }
    await update((batch) => { batch.status = 'queued'; batch.lease = null; batch.leaseUntil = null; });
  } catch (error) {
    await update((batch) => { batch.status = 'error'; batch.lease = null; batch.leaseUntil = null; batch.warnings.push(error instanceof Error ? error.message : 'Batch interrupted. Resume to continue.'); });
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
