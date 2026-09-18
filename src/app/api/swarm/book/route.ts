import { listRepRecords, saveRepRecord } from '@/lib/swarm/rep-store';
import { sameOrigin } from '@/lib/swarm/request-origin';
import { cloudConfigured } from '@/lib/swarm/cloud-store';
import type { LeadRecord } from '@/lib/swarm/lead-book';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET() {
  try { return Response.json({ records: await listRepRecords<LeadRecord>('leads'), cloud: cloudConfigured() }, { headers }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Could not load saved businesses.' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  try {
    const body = await request.json(); const r = body.record as LeadRecord;
    if (!r || typeof r.key !== 'string' || r.key.length > 1000 || !['saved','hidden','active'].includes(r.disposition) || typeof r.notes !== 'string' || r.notes.length > 20000 || typeof r.contactName !== 'string' || r.contactName.length > 200 || typeof r.card?.business?.name !== 'string' || !Array.isArray(r.source?.addresses) || typeof r.updatedAt !== 'string' || JSON.stringify(r).length > 300000) throw new Error('Invalid business record.');
    const record = await saveRepRecord('leads', r, body.importOnly === true);
    return Response.json({ record }, { headers });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Could not save this business.' }, { status: 400, headers }); }
}
