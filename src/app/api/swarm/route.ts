import { after } from "next/server";
import { createSwarm, ensureSwarmWorker, runSwarm, swarmPending } from "@/lib/swarm/engine";
import { listSwarmBatches, mutateSwarm, readSwarm } from "@/lib/swarm/store";
import { parseAddressBatch } from "@/lib/swarm/logic";
import { isServerlessFilesystem } from "@/lib/writable-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
async function payload(id?: string | null) {
  return { batch: id ? await readSwarm(id) : null, batches: await listSwarmBatches(), persistent: !isServerlessFilesystem() };
}
export async function GET(request: Request) {
  try {
    ensureSwarmWorker();
    const result = await payload(new URL(request.url).searchParams.get('id'));
    if (result.batch && swarmPending(result.batch)) { const id = result.batch.id; after(() => runSwarm(id)); }
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return Response.json({ error: 'Could not load this batch.' }, { status: 503 }); }
}
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
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
        switch (body.action) {
          case 'pause': batch.status = 'paused'; batch.lease = null; batch.leaseUntil = null; break;
          case 'refresh':
            if (swarmPending(batch)) throw new Error('Pause the current scan before refreshing.');
            batch.status = 'queued';
            for (const address of batch.addresses) { address.status = 'pending'; address.error = null; address.discovered = 0; }
            for (const card of batch.prospects) card.broadbandChecked = false;
            break;
          case 'resume':
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
    if (body.action !== 'pause') after(() => runSwarm(id));
    return Response.json(await payload(id), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Could not save this batch.' }, { status: 400 }); }
}
