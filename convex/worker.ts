import { makeFunctionReference } from 'convex/server';
import { internalAction, internalQuery } from './lib/server';
export const pending = internalQuery({ args: {}, handler: async ctx => {
  const batches = await ctx.db.query('records').withIndex('by_work', q => q.eq('collection', 'swarm').eq('active',true)).order('asc').take(4);
  return batches.map(b => b.key);
}});
// A durable wake-up survives web-server restarts and closed browser tabs.
export const wake = internalAction({ args: {}, handler: async ctx => {
  const base = process.env.FINDBIZ_APP_URL, token = process.env.FINDBIZ_STORAGE_SECRET;
  if (!base || !token) return;
  const ids: string[] = await ctx.runQuery(makeFunctionReference<'query'>('worker:pending'), {});
  await Promise.all(ids.map(async id => {
    const response = await fetch(new URL('/api/swarm/worker', base), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Swarm worker wake failed (${response.status}).`);
  }));
}});
