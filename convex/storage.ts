import { makeFunctionReference } from 'convex/server';
import { mutation, query, internalMutation } from './lib/server';
import { v, ConvexError } from 'convex/values';

// Only the Next.js server possesses this key. FindBiz is a shared rep workspace.
function authorize(token: string) {
  const expected = process.env.FINDBIZ_STORAGE_SECRET;
  if (!expected || token !== expected) throw new ConvexError('Storage access denied.');
}
const identity = { token: v.string(), collection: v.string(), key: v.string() };
export const uploadUrl = mutation({ args: { token: v.string() }, handler: async (ctx,args) => {
  authorize(args.token); return ctx.storage.generateUploadUrl();
}});
export const read = query({ args: identity, handler: async (ctx,args) => {
  authorize(args.token);
  const record = await ctx.db.query('records').withIndex('by_key', q=>q.eq('collection',args.collection).eq('key',args.key)).unique();
  if (!record) return null;
  if (record.storageId) return { revision: record.revision, url: await ctx.storage.getUrl(record.storageId) };
  // Compatibility with the first chunked checkpoint format.
  const chunks = await ctx.db.query('chunks').withIndex('by_record',q=>q.eq('record',record._id)).collect();
  return { revision: record.revision, text: chunks.map(c=>c.text).join('') };
}});
export const list = query({ args: { token: v.string(), collection: v.string(), cursor: v.union(v.string(),v.null()) }, handler: async(ctx,args)=>{
  authorize(args.token);
  const page=await ctx.db.query('records').withIndex('by_collection',q=>q.eq('collection',args.collection)).order('desc').paginate({numItems:100,cursor:args.cursor});
  return {...page,page:page.page.map(r=>({key:r.key,revision:r.revision,summary:r.summary}))};
}});
// Immutable compressed snapshots live in Convex file storage. This tiny transaction
// atomically advances the checkpoint and lease, regardless of the size of a Swarm.
export const compareAndSet = mutation({
  args: {...identity,expected:v.union(v.number(),v.null()),storageId:v.id('_storage'),summary:v.any()},
  handler:async(ctx,args)=>{
    authorize(args.token);
    const record=await ctx.db.query('records').withIndex('by_key',q=>q.eq('collection',args.collection).eq('key',args.key)).unique();
    if(record?.storageId===args.storageId)return true; // Safe retry after an uncertain response.
    if((record?.revision??null)!==args.expected){
      await ctx.storage.delete(args.storageId);
      return false;
    }
    if(!await ctx.db.system.get(args.storageId))throw new ConvexError('Checkpoint upload is missing.');
    const revision=(record?.revision??0)+1;
    const fields={collection:args.collection,key:args.key,revision,summary:args.summary,updatedAt:Date.now(),storageId:args.storageId,active:args.collection==='swarm' && !args.summary?.archivedAt && ['queued','scanning','qualifying','researching'].includes(args.summary?.status)};
    if(record) {
      await ctx.db.patch(record._id,fields);
      if(record.storageId) await ctx.scheduler.runAfter(3600000,makeFunctionReference<'mutation'>('storage:discard'),{storageId:record.storageId});
    } else await ctx.db.insert('records',fields);
    return true;
  }
});
export const discard=internalMutation({args:{storageId:v.id('_storage')},handler:async(ctx,args)=>{await ctx.storage.delete(args.storageId);}});
