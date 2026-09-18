import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { isServerlessFilesystem } from "@/lib/writable-store";
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
const compress = promisify(gzip), decompress = promisify(gunzip);

export class StorageUnavailable extends Error {}
export function cloudConfigured() { return Boolean(process.env.CONVEX_URL && process.env.FINDBIZ_STORAGE_SECRET); }
export function requireDurableStorage() {
  if ((isServerlessFilesystem() || process.env.CONVEX_URL) && !cloudConfigured()) {
    throw new StorageUnavailable("Connect Convex to enable saved Swarm batches on this deployment. Set CONVEX_URL and FINDBIZ_STORAGE_SECRET on the server.");
  }
}
function client() {
  requireDurableStorage();
  if (!cloudConfigured()) throw new StorageUnavailable("Convex is not configured.");
  return new ConvexHttpClient(process.env.CONVEX_URL!);
}
const token = () => process.env.FINDBIZ_STORAGE_SECRET!;
export async function cloudRead<T>(collection: string, key: string): Promise<{ revision: number; value: T } | null> {
  const result = await client().query(makeFunctionReference<"query">("storage:read"), { token: token(), collection, key }) as { revision: number; text?: string; url?: string | null } | null;
  if (!result) return null;
  if (result.text !== undefined) return { revision: result.revision, value: JSON.parse(result.text) as T };
  if (!result.url) throw new Error('Saved checkpoint is unavailable. Please retry.');
  const response = await fetch(result.url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Could not read the saved checkpoint. Please retry.');
  const text = (await decompress(Buffer.from(await response.arrayBuffer()))).toString('utf8');
  return { revision: result.revision, value: JSON.parse(text) as T };
}
export async function cloudList<T>(collection: string): Promise<{ key: string; revision: number; summary: T }[]> {
  const rows: { key: string; revision: number; summary: T }[] = [];
  let cursor: string | null = null;
  do {
    const result = await client().query(makeFunctionReference<"query">("storage:list"), { token: token(), collection, cursor }) as { page: typeof rows; continueCursor: string; isDone: boolean };
    rows.push(...result.page); cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  return rows;
}
export async function cloudWrite<T>(collection: string, key: string, expected: number | null, value: T, summary: unknown): Promise<boolean> {
  const api = client();
  const uploadUrl = await api.mutation(makeFunctionReference<'mutation'>('storage:uploadUrl'), { token: token() }) as string;
  const compressed = await compress(JSON.stringify(value));
  const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body: new Uint8Array(compressed), signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Could not upload the checkpoint. Existing saved results are safe.');
  const { storageId } = await response.json();
  return api.mutation(makeFunctionReference<"mutation">("storage:compareAndSet"), { token: token(), collection, key, expected, storageId, summary });
}
export async function updateCloud<T>(collection: string, key: string, mutate: (value: T | null) => T, summarize: (value: T) => unknown = value => value): Promise<T> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const previous = await cloudRead<T>(collection, key);
    const next = mutate(previous ? structuredClone(previous.value) : null);
    if (previous && JSON.stringify(previous.value) === JSON.stringify(next)) return next;
    if (await cloudWrite(collection, key, previous?.revision ?? null, next, summarize(next))) return next;
    await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 80));
  }
  throw new Error("Another update is still saving. Please retry.");
}
