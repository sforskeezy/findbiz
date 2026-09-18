import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { cloudConfigured, cloudList, cloudRead, requireDurableStorage, updateCloud } from "@/lib/swarm/cloud-store";
import { swarmRoot } from "@/lib/swarm/store";
import type { LeadRecord } from "@/lib/swarm/lead-book";
export type { TerritoryReview } from "@/lib/swarm/territory";
async function directory(collection: string) { const root = path.join(await swarmRoot(), collection); await mkdir(root, { recursive: true }); return root; }
async function localFile(collection: string, key: string) { return path.join(await directory(collection), `${createHash('sha256').update(key).digest('hex')}.json`); }
export async function listRepRecords<T>(collection: 'leads' | 'territory'): Promise<T[]> {
  requireDurableStorage();
  if (cloudConfigured()) {
    const summaries = await cloudList<{ key: string }>(collection);
    const records: T[] = [];
    for (let i=0;i<summaries.length;i+=8) {
      const page=await Promise.all(summaries.slice(i,i+8).map(row=>cloudRead<T>(collection,row.key)));
      for (const row of page) if(row)records.push(row.value);
    }
    return records;
  }
  const root = await directory(collection);
  return Promise.all((await readdir(root)).filter(f => f.endsWith('.json')).map(async file => JSON.parse(await readFile(path.join(root, file), 'utf8')) as T));
}
export async function saveRepRecord<T extends { key: string }>(collection: 'leads' | 'territory', record: T, importOnly = false): Promise<T> {
  requireDurableStorage();
  if (cloudConfigured()) return updateCloud<T>(collection, record.key, existing => importOnly && existing ? existing : record, value => ({key:value.key}));
  const file = await localFile(collection, record.key);
  if (importOnly) { try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(record)); await rename(temporary, file); } finally { await rm(temporary, { force: true }); }
  return record;
}
export async function readSavedLead(key: string): Promise<LeadRecord | null> {
  if (cloudConfigured()) return (await cloudRead<LeadRecord>('leads', key))?.value ?? null;
  try { return JSON.parse(await readFile(await localFile('leads', key), 'utf8')) as LeadRecord; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
