import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureWritableStore, preferredStorePath } from "@/lib/writable-store";
import type { SwarmBatch, SwarmSummary } from "@/lib/swarm/types";
const validId = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export async function swarmRoot() { return ensureWritableStore(preferredStorePath(process.env.SWARM_STORE_PATH, "swarm"), []); }
async function fileFor(id: string) { if (!validId(id)) throw new Error("Invalid batch."); return path.join(await swarmRoot(), `${id}.json`); }
export async function readSwarm(id: string): Promise<SwarmBatch | null> {
  try { return JSON.parse(await readFile(await fileFor(id), "utf8")) as SwarmBatch; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function writeSwarm(batch: SwarmBatch) {
  const file = await fileFor(batch.id), temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(batch)); await rename(temp, file); } finally { await rm(temp, { force: true }); }
}
export async function mutateSwarm(id: string, mutate: (batch: SwarmBatch) => void) {
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
export async function listSwarmBatches(): Promise<SwarmSummary[]> {
  const files = (await readdir(await swarmRoot())).filter((file) => file.endsWith('.json') && validId(file.slice(0, -5)));
  const summaries = await Promise.all(files.map(async (file) => { const batch = await readSwarm(file.slice(0, -5)); return batch ? { id: batch.id, title: batch.title, createdAt: batch.createdAt, updatedAt: batch.updatedAt, status: batch.status, addresses: batch.addresses.length, prospects: batch.prospects.length } : null; }));
  return summaries.filter((item): item is SwarmSummary => item !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
