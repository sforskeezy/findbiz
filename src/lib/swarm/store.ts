import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureWritableStore, preferredStorePath } from "@/lib/writable-store";
import type { SwarmBatch, SwarmSummary } from "@/lib/swarm/types";
import { cloudConfigured, cloudRead, cloudList, cloudWrite, requireDurableStorage, updateCloud } from "@/lib/swarm/cloud-store";
const validId = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export async function swarmRoot() { requireDurableStorage(); return ensureWritableStore(preferredStorePath(process.env.SWARM_STORE_PATH, "swarm"), []); }
export const summarizeSwarm = (batch: SwarmBatch): SwarmSummary => ({ id: batch.id, title: batch.title, createdAt: batch.createdAt, updatedAt: batch.updatedAt, status: batch.status, addresses: batch.addresses.length, prospects: batch.prospects.length, archivedAt: batch.archivedAt ?? null });
async function fileFor(id: string) { if (!validId(id)) throw new Error("Invalid batch."); return path.join(await swarmRoot(), `${id}.json`); }
export async function readSwarm(id: string): Promise<SwarmBatch | null> {
  requireDurableStorage();
  if (!validId(id)) throw new Error("Invalid batch.");
  if (cloudConfigured()) return (await cloudRead<SwarmBatch>("swarm", id))?.value ?? null;
  try { return JSON.parse(await readFile(await fileFor(id), "utf8")) as SwarmBatch; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function writeSwarm(batch: SwarmBatch) {
  requireDurableStorage();
  if (cloudConfigured()) {
    if (!await cloudWrite("swarm", batch.id, null, batch, summarizeSwarm(batch))) throw new Error("Batch already exists.");
    return;
  }
  const file = await fileFor(batch.id), temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(batch)); await rename(temp, file); } finally { await rm(temp, { force: true }); }
}
export async function mutateSwarm(id: string, mutate: (batch: SwarmBatch) => void) {
  requireDurableStorage();
  if (!validId(id)) throw new Error("Invalid batch.");
  if (cloudConfigured()) return updateCloud<SwarmBatch>("swarm", id, batch => {
    if (!batch) throw new Error("Batch not found.");
    const before = JSON.stringify(batch);
    mutate(batch);
    if (JSON.stringify(batch) !== before) batch.updatedAt = new Date().toISOString();
    return batch;
  }, summarizeSwarm);
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
