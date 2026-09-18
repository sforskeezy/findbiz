import { isValidCell } from 'h3-js';
import { listRepRecords, saveRepRecord, type TerritoryReview } from '@/lib/swarm/rep-store';
import { sameOrigin } from '@/lib/swarm/request-origin';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET() {
  try { return Response.json({ records: await listRepRecords<TerritoryReview>('territory') }, { headers }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Could not load reviewed clusters.' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  try {
    const { key, reviewed, prospectIds } = await request.json();
    if (typeof key !== 'string' || !isValidCell(key) || typeof reviewed !== 'boolean' || !Array.isArray(prospectIds) || prospectIds.length > 20000 || prospectIds.some((id: unknown) => typeof id !== 'string' || id.length > 500)) throw new Error('Choose a valid cluster.');
    const record: TerritoryReview = { key, reviewedAt: reviewed ? new Date().toISOString() : null, prospectIds: reviewed ? prospectIds : [] };
    await saveRepRecord('territory', record);
    return Response.json({ record }, { headers });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Could not save cluster.' }, { status: 400, headers }); }
}
