import { after } from "next/server";
import { createSwarm, ensureSwarmWorker, runSwarm, swarmPending } from "@/lib/swarm/engine";
import { listSwarmBatches, mutateSwarm, readSwarm } from "@/lib/swarm/store";
import { parseAddressBatch } from "@/lib/swarm/logic";
import { cloudConfigured, StorageUnavailable } from "@/lib/swarm/cloud-store";
import { sameOrigin } from "@/lib/swarm/request-origin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
async function payload(id?: string | null) {
  const [batch, all] = await Promise.all([id ? readSwarm(id) : null, listSwarmBatches(true)]);
  return { batch, batches: all.filter(b=>!b.archivedAt), archivedBatches: all.filter(b=>b.archivedAt), persistent: true, storage: cloudConfigured() ? 'convex' : 'local' };
}

export async function GET(request: Request) {
  try {
    ensureSwarmWorker();
    const result = await payload(new URL(request.url).searchParams.get('id'));
    if (new URL(request.url).searchParams.get('id') && !result.batch) return Response.json({ ...result, error: 'This batch is not in saved storage. Retry the connection or choose another saved batch.' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    if (result.batch && swarmPending(result.batch)) { const id = result.batch.id; after(() => runSwarm(id)); }
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return Response.json({ error: error instanceof StorageUnavailable ? error.message : 'Storage is temporarily unavailable. Your saved results have not been deleted. Retrying…' }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') throw new Error('A JSON request is required.');
    ensureSwarmWorker();
    let id = typeof body.id === 'string' ? body.id : '';
    if (body.action === 'create') {
      if (typeof body.addresses !== 'string') throw new Error('Paste one address per line.');
      const parsed = parseAddressBatch(body.addresses);
      if (!parsed.addresses.length) throw new Error('Add at least one address. Include a city or ZIP so it can be located.');
      if (parsed.invalid.length) throw new Error(`Fix these address lines first: ${parsed.invalid.slice(0, 3).join('; ')}`);
      if (typeof body.radiusMiles !== 'number' || !Number.isFinite(body.radiusMiles) || body.radiusMiles < 0.1 || body.radiusMiles > 10) throw new Error('Choose a radius from 0.1 to 10 miles.');
      const batch = await createSwarm(parsed.addresses, body.radiusMiles, typeof body.title === 'string' ? body.title : undefined);
      id = batch.id;
    } else {
      await mutateSwarm(id, (batch) => {
        if (batch.archivedAt && ['refresh','resume','research'].includes(body.action)) throw new Error('Restore this batch before running it.');
        switch (body.action) {
          case 'remove': batch.archivedAt = new Date().toISOString(); batch.status = 'paused'; batch.lease = null; batch.leaseUntil = null; break;
          case 'restore': batch.archivedAt = null; break;
          case 'rename':
            if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) throw new Error('Give this batch a name, up to 100 characters.');
            batch.title = body.title.trim(); break;
          case 'pause': batch.status = 'paused'; batch.lease = null; batch.leaseUntil = null; break;
          case 'refresh':
            if (swarmPending(batch)) throw new Error('Pause the current scan before refreshing.');
            batch.status = 'queued';
            for (const address of batch.addresses) { address.status = 'pending'; address.error = null; address.discovered = 0; }
            for (const card of batch.prospects) card.broadbandChecked = false;
            break;
          case 'resume':
            if (batch.archivedAt) throw new Error('Restore this batch before resuming.');
            batch.status = 'queued';
            for (const address of batch.addresses) if (address.status === 'error') { address.status = 'pending'; address.error = null; }
            for (const card of batch.prospects) if (card.error && !card.broadband) card.broadbandChecked = false;
            break;
          case 'research': {
            if (!Array.isArray(body.selected) || !body.selected.length || body.selected.length > 1000 || body.selected.some((id: unknown) => typeof id !== 'string' || !batch.prospects.some((p) => p.id === id))) throw new Error('Select valid prospects from this batch.');
            for (const prospect of batch.prospects) if (body.selected.includes(prospect.id)) prospect.researchStatus = 'queued';
            if (!swarmPending(batch)) batch.status = 'queued';
            break;
          }
          default: throw new Error('Unknown batch action.');
        }
      });
    }
    if (['create','refresh','resume','research'].includes(body.action)) after(() => runSwarm(id));
    return Response.json(await payload(id), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Could not save this batch.' }, { status: 400 }); }
}
