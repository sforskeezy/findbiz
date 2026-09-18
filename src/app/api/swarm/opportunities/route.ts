import { listSwarmBatches, readSwarm } from '@/lib/swarm/store';
import { listRepRecords } from '@/lib/swarm/rep-store';
import { buildOpportunityPool } from '@/lib/swarm/opportunities';
import type { LeadRecord } from '@/lib/swarm/lead-book';
import type { TerritoryReview } from '@/lib/swarm/territory';
import type { SwarmBatch } from '@/lib/swarm/types';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

export async function GET() {
  try {
    const [summaries,records,reviews]=await Promise.all([listSwarmBatches(),listRepRecords<LeadRecord>('leads'),listRepRecords<TerritoryReview>('territory')]);
    const batches:SwarmBatch[]=[];
    let unavailable=0;
    // Bound checkpoint reads so a large workspace cannot flood storage.
    for(let index=0;index<summaries.length;index+=6) {
      const page=await Promise.allSettled(summaries.slice(index,index+6).map(s=>readSwarm(s.id)));
      for(const item of page) if(item.status==='fulfilled'&&item.value)batches.push(item.value);else unavailable++;
    }
    if(summaries.length&&!batches.length)throw new Error('No batches could be read');
    return Response.json({...buildOpportunityPool(batches,records,reviews),unavailable},{headers:{'Cache-Control':'private, no-store'}});
  } catch { return Response.json({error:'Could not read your saved Swarms. Retry in a moment; your records are unchanged.'},{status:503}); }
}
