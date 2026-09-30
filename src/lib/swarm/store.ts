import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureWritableStore, preferredStorePath } from "@/lib/writable-store";
import type { SwarmBatch, SwarmSummary } from "@/lib/swarm/types";
import type { FccLookupResponse } from "@/lib/types";
import { cloudConfigured, cloudRead, cloudList, cloudWrite, requireDurableStorage, updateCloud } from "@/lib/swarm/cloud-store";
const validId = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export async function swarmRoot() { requireDurableStorage(); return ensureWritableStore(preferredStorePath(process.env.SWARM_STORE_PATH, "swarm"), []); }
export const summarizeSwarm = (batch: SwarmBatch): SwarmSummary => ({ id: batch.id, title: batch.title, createdAt: batch.createdAt, updatedAt: batch.updatedAt, status: batch.status, addresses: batch.addresses.length, prospects: batch.prospects.length, archivedAt: batch.archivedAt ?? null });

/**
 * Businesses in one census block share an identical FCC report, and it made up most
 * of a snapshot. Saved snapshots keep each distinct report once and cards point at it.
 * Snapshots without a pool (older saves) read unchanged.
 */
type StoredSwarm = SwarmBatch & { broadbandPool?: FccLookupResponse[] };
type PooledReport = { pooled: number };
export function packSwarm(batch: SwarmBatch): StoredSwarm {
  const pool: FccLookupResponse[] = [];
  const slots = new Map<string, number>();
  const prospects = batch.prospects.map((card) => {
    if (!card.broadband) return card;
    const key = JSON.stringify(card.broadband);
    let slot = slots.get(key);
    if (slot === undefined) { slot = pool.length; pool.push(card.broadband); slots.set(key, slot); }
    return { ...card, broadband: { pooled: slot } as unknown as FccLookupResponse };
  });
  return pool.length ? { ...batch, prospects, broadbandPool: pool } : batch;
}
export function unpackSwarm(stored: StoredSwarm): SwarmBatch {
  const { broadbandPool, ...batch } = stored;
  if (!broadbandPool) return stored;
  for (const card of batch.prospects) {
    const slot = (card.broadband as unknown as PooledReport | null)?.pooled;
    if (typeof slot === "number") card.broadband = broadbandPool[slot] ?? null;
  }
  return batch;
}

async function fileFor(id: string) { if (!validId(id)) throw new Error("Invalid batch."); return path.join(await swarmRoot(), `${id}.json`); }
export async function readSwarm(id: string): Promise<SwarmBatch | null> {
  requireDurableStorage();
  if (!validId(id)) throw new Error("Invalid batch.");
  if (cloudConfigured()) { const stored = (await cloudRead<StoredSwarm>("swarm", id))?.value; return stored ? unpackSwarm(stored) : null; }
  try { return unpackSwarm(JSON.parse(await readFile(await fileFor(id), "utf8")) as StoredSwarm); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function writeSwarm(batch: SwarmBatch) {
  requireDurableStorage();
  if (cloudConfigured()) {
    if (!await cloudWrite("swarm", batch.id, null, packSwarm(batch), summarizeSwarm(batch))) throw new Error("Batch already exists.");
    return;
  }
  const file = await fileFor(batch.id), temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(packSwarm(batch))); await rename(temp, file); } finally { await rm(temp, { force: true }); }
}
export async function mutateSwarm(id: string, mutate: (batch: SwarmBatch) => void) {
  requireDurableStorage();
  if (!validId(id)) throw new Error("Invalid batch.");
  if (cloudConfigured()) {
    let current: SwarmBatch | null = null;
    await updateCloud<StoredSwarm>("swarm", id, stored => {
      if (!stored) throw new Error("Batch not found.");
      const batch = unpackSwarm(stored);
      const before = JSON.stringify(batch);
      mutate(batch);
      if (JSON.stringify(batch) !== before) batch.updatedAt = new Date().toISOString();
      current = batch;
      return packSwarm(batch);
    }, summarizeSwarm);
    return current as unknown as SwarmBatch;
  }
  const lock = `${await fileFor(id)}.lock`;
  let acquired = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { await mkdir(lock); acquired = true; break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try { if (Date.now() - (await stat(lock)).mtimeMs > 60_000) await rm(lock, { recursive: true, force: true }); } catch { /* Released by another writer. */ }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }
  if (!acquired) throw new Error("Batch is busy saving. Please retry.");
  try { const batch = await readSwarm(id); if (!batch) throw new Error("Batch not found."); mutate(batch); batch.updatedAt = new Date().toISOString(); await writeSwarm(batch); return batch; }
  finally { await rm(lock, { recursive: true, force: true }); }
}
export async function listSwarmBatches(includeArchived = false): Promise<SwarmSummary[]> {
  requireDurableStorage();
  if (cloudConfigured()) return (await cloudList<SwarmSummary>("swarm")).map(row => row.summary).filter(row => includeArchived || !row.archivedAt).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const files = (await readdir(await swarmRoot())).filter((file) => file.endsWith('.json') && validId(file.slice(0, -5)));
  const summaries = await Promise.all(files.map(async (file) => { const batch = await readSwarm(file.slice(0, -5)); return batch ? summarizeSwarm(batch) : null; }));
  return summaries.filter((item): item is SwarmSummary => item !== null && (includeArchived || !item.archivedAt)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
