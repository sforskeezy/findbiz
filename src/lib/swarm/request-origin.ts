function originFor(value: string | null) { try { return value ? new URL(value).origin.toLowerCase() : null; } catch { return null; } }
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const allowed = new Set([originFor(request.url), originFor(process.env.NEXT_PUBLIC_APP_URL ?? null), originFor(process.env.APP_URL ?? null)]);
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host')?.trim();
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(request.url).protocol.replace(':', '');
  if (host && /^https?$/i.test(proto) && /^[a-z0-9.-]+(?::\d+)?$/i.test(host)) allowed.add(`${proto.toLowerCase()}://${host.toLowerCase()}`);
  return allowed.has(originFor(origin)) && originFor(origin) !== null;
}
