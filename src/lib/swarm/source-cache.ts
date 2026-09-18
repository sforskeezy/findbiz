/** Coalesce overlapping lookups without carrying failures or stale results into refreshes. */
export function sourceCache<T>(ttlMs: number, limit = 512) {
  const entries = new Map<string, { expires: number; result: Promise<T> }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const existing = entries.get(key);
    if (existing && existing.expires > Date.now()) return existing.result;
    const result = load().catch(error => { if (entries.get(key)?.result === result) entries.delete(key); throw error; });
    entries.delete(key);
    entries.set(key, { result, expires: Date.now() + ttlMs });
    if (entries.size > limit) entries.delete(entries.keys().next().value!);
    return result;
  };
}
