import { listStoredSessions, loadSession } from "@/lib/live/store";
import type { LiveSession } from "@/lib/live/types";
import type { Prospect } from "@/lib/types";

type Identity = Pick<Prospect, "id" | "name" | "address" | "phone">;
const words = (value: string) => value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
const STOP = new Set(['the', 'and', 'our', 'chat', 'chats', 'last', 'previous', 'about', 'what', 'that', 'this', 'from', 'were', 'have', 'with', 'remember', 'business', 'businesses', 'was', 'did', 'say', 'said', 'discuss', 'discussed', 'conversation', 'conversations', 'please', 'tell', 'can', 'you', 'ago', 'latest']);
export const asksAboutHistory = (text: string) => /\b(last|previous|earlier|other|past) (?:chat|conversation|search|list)|\b(?:remember|recall|already (?:seen|checked|searched)|where (?:were|did) we|pick up where|continue (?:the |our )?(?:last|previous))/i.test(text);

function historicalExcerpt(text: string, tokens: string[]) {
  if (text.length <= 1600) return text;
  const positions = tokens.map((token) => text.toLowerCase().indexOf(token)).filter((position) => position >= 0);
  const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 350);
  return `${start ? '…' : ''}${text.slice(start, start + 1600)}${start + 1600 < text.length ? '…' : ''}`;
}

export async function recallConversations(query: string, currentId?: string, limit = 5) {
  const sessions = await listStoredSessions();
  const tokens = words(query).filter((word) => !STOP.has(word));
  const matches = sessions.map((session, index) => {
    const messages = session.messages.filter((message) => message.content.trim());
    const hay = `${session.title} ${session.queue?.locationLabel ?? ''} ${session.activeCompany?.name ?? ''} ${messages.map((message) => message.content).join(' ')}`.toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (hay.includes(token) ? 4 : 0), 0) + (index < 3 ? 1 : 0);
    const relevant = messages.map((message, position) => ({ message, position, score: tokens.reduce((sum, token) => sum + (message.content.toLowerCase().includes(token) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score || b.position - a.position).slice(0, 6).sort((a, b) => a.position - b.position);
    return { id: session.id, title: session.title, updatedAt: session.updatedAt, area: session.queue?.locationLabel ?? session.brief?.locationHint ?? null, radiusMiles: session.queue?.radiusMiles, activeCompany: session.activeCompany?.name ?? null, prospects: session.queue?.prospects.slice(0, 12).map(({ name, address, phone }) => ({ name, address, phone })) ?? [], excerpts: relevant.map(({ message }) => ({ role: message.role, text: historicalExcerpt(message.content, tokens), at: message.createdAt })), score };
  }).filter((session) => session.id !== currentId || session.excerpts.length > 2);
  return matches.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.min(10, Math.max(1, limit)));
}

export async function territoryHistory(currentId?: string): Promise<{ latest: LiveSession | null; seen: Identity[]; areas: Array<{ location: string; radius: number; at: string; businesses: number; sessionId: string }> }> {
  const sessions = await listStoredSessions();
  const seen = new Map<string, Identity>();
  const areas: Array<{ location: string; radius: number; at: string; businesses: number; sessionId: string }> = [];
  for (const session of sessions) {
    for (const p of [...(session.seenBusinesses ?? []), ...(session.queue?.prospects ?? [])]) {
      const key = `${p.name.toLowerCase().replace(/[^a-z0-9]/g, '')}:${p.address.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      seen.set(key, { id: p.id, name: p.name, address: p.address, phone: p.phone });
    }
    for (const area of session.searchedAreas ?? []) areas.push({ ...area, sessionId: session.id });
    if (session.queue && !(session.searchedAreas ?? []).some((area) => area.location === session.queue!.locationLabel && area.radius === session.queue!.radiusMiles)) areas.push({ location: session.queue.locationLabel, radius: session.queue.radiusMiles, at: session.updatedAt, businesses: session.queue.prospects.length, sessionId: session.id });
  }
  const { listSwarmBatches, readSwarm } = await import("@/lib/swarm/store");
  for (const summary of await listSwarmBatches()) {
    const batch = await readSwarm(summary.id);
    if (!batch) continue;
    for (const card of batch.prospects) { const p = card.business; seen.set(`${p.name.toLowerCase().replace(/[^a-z0-9]/g, '')}:${p.address.toLowerCase().replace(/[^a-z0-9]/g, '')}`, { id: p.id, name: p.name, address: p.address, phone: p.phone }); }
    for (const address of batch.addresses.filter((a) => a.status === 'complete')) areas.push({ location: address.text, radius: batch.radiusMiles, at: batch.updatedAt, businesses: address.discovered, sessionId: `swarm:${batch.id}` });
  }
  return { latest: sessions.find((session) => session.id !== currentId && (session.queue || session.activeCompany)) ?? null, seen: [...seen.values()], areas: areas.sort((a,b) => b.at.localeCompare(a.at)).slice(0, 40) };
}

export async function restorePreviousContext(session: LiveSession, query: string) {
  const matches = await recallConversations(query, session.id);
  const match = matches.find((item) => item.id !== session.id);
  if (!match) return null;
  const previous = await loadSession(match.id);
  if (!previous) return null;
  session.queue = previous.queue ? structuredClone(previous.queue) : null;
  session.activeCompany = previous.activeCompany ? structuredClone(previous.activeCompany) : null;
  session.brief = previous.brief ? { ...previous.brief, wantsResearch: false, wantsNews: false, wantsWeb: false, wantsGenuineCheck: false, wantsCompetitors: false, webQueries: [] } : null;
  return match;
}

export async function recallSwarmBatches(query: string) {
  const { listSwarmBatches, readSwarm } = await import("@/lib/swarm/store");
  const tokens = words(query).filter((token) => !STOP.has(token));
  const matches = [];
  for (const summary of (await listSwarmBatches()).slice(0, 30)) {
    const batch = await readSwarm(summary.id);
    if (!batch) continue;
    const relevant = batch.prospects.filter((p) => tokens.some((token) => `${p.business.name} ${p.business.address}`.toLowerCase().includes(token)));
    matches.push({ id: batch.id, title: batch.title, url: `/swarm?batch=${batch.id}`, status: batch.status, at: batch.updatedAt, addresses: batch.addresses.slice(0, 15).map((a) => ({ address: a.text, status: a.status })), prospectCount: batch.prospects.length, prospects: (relevant.length ? relevant : batch.prospects).slice(0, 10).map((p) => ({ name: p.business.name, address: p.business.address, phone: p.business.phone })), score: relevant.length });
  }
  return matches.sort((a,b) => b.score-a.score || b.at.localeCompare(a.at)).slice(0, 3);
}
