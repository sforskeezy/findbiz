import { timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';
import { runSwarm } from '@/lib/swarm/engine';
import { readSwarm } from '@/lib/swarm/store';
export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(request: Request) {
  const expected = process.env.FINDBIZ_STORAGE_SECRET;
  const actual = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!expected || Buffer.byteLength(expected) !== Buffer.byteLength(actual) || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return new Response(null, { status: 401 });
  const { id } = await request.json();
  if (typeof id !== 'string' || !await readSwarm(id)) return new Response(null, { status: 404 });
  after(() => runSwarm(id));
  return Response.json({ accepted: true });
}
