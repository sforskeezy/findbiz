import { digits, findLead, type LeadRecord } from '@/lib/swarm/lead-book';
import type { DealPlan } from '@/lib/swarm/deal-plan';
import type { SwarmProspect } from '@/lib/swarm/types';

export type CallOutcome = 'no_answer' | 'callback' | 'interested' | 'not_interested';
export type QueueReason = 'callback_due' | 'fresh' | 'retry';
export type QueueItem = { card: SwarmProspect; reason: QueueReason };
export type SessionEntry = { id: string; name: string; outcome: CallOutcome; at: number; callbackAt?: string };

/** A no-answer is worth another try once the business has had a few hours to change shifts. */
export const RETRY_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Callable, in-lane leads in the order a rep should dial them: callbacks that are due,
 * then businesses never called (keeping the caller's ranking), then stale no-answers.
 * Connected leads and callbacks scheduled for later stay out of the way.
 */
export function powerQueue(cards: SwarmProspect[], records: LeadRecord[], plans: Map<string, DealPlan>, now = Date.now()): QueueItem[] {
  const tiers: [QueueItem[], QueueItem[], QueueItem[]] = [[], [], []];
  const due: Map<string, number> = new Map();
  for (const card of cards) {
    if (digits(card.business.phone).length < 7 || plans.get(card.id)?.lane.status === 'out') continue;
    const record = findLead(records, card);
    if (record?.disposition === 'hidden') continue;
    const activity = record?.activity;
    if (!activity) { tiers[1].push({ card, reason: 'fresh' }); continue; }
    if (activity.outcome === 'callback') {
      const at = Date.parse(activity.callbackAt ?? '');
      if (Number.isFinite(at) && at > now) continue;
      due.set(card.id, Number.isFinite(at) ? at : 0);
      tiers[0].push({ card, reason: 'callback_due' });
    } else if (activity.outcome === 'no_answer' && !(now - Date.parse(activity.at) < RETRY_AFTER_MS)) {
      tiers[2].push({ card, reason: 'retry' });
    }
  }
  tiers[0].sort((a, b) => due.get(a.card.id)! - due.get(b.card.id)!);
  return tiers.flat();
}

export function activityFor(outcome: CallOutcome, at: Date, callbackAt?: Date): NonNullable<LeadRecord['activity']> {
  const stamp = at.toISOString();
  if (outcome === 'no_answer') return { outcome: 'no_answer', at: stamp };
  if (outcome === 'callback') return { outcome: 'callback', at: stamp, callbackAt: (callbackAt ?? at).toISOString() };
  return { outcome: 'connected', at: stamp, result: outcome };
}

export const OUTCOME_LABEL: Record<CallOutcome, string> = { no_answer: 'No answer', callback: 'Call back', interested: 'Interested', not_interested: 'Not interested' };

/** One dated line per call, so the notes read as a call log. */
export function callNote(outcome: CallOutcome, at: Date, note: string, callbackAt?: Date) {
  const when = at.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const callback = outcome === 'callback' && callbackAt ? ` for ${callbackAt.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
  return `${when} · ${OUTCOME_LABEL[outcome]}${callback}${note.trim() ? ` · ${note.trim()}` : ''}`;
}

/** Quick callback times relative to now. "Tomorrow" means the next weekday, so Friday's callbacks land on Monday. */
export function callbackChoices(now = new Date()): { label: string; at: Date }[] {
  const at = (days: number, hour: number) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  const choices = [{ label: 'In 1 hour', at: later }];
  if (now.getHours() < 15) choices.push({ label: 'This afternoon', at: at(0, 16) });
  const next = now.getDay() === 5 ? 3 : now.getDay() === 6 ? 2 : 1;
  const day = next === 1 ? 'Tomorrow' : at(next, 9).toLocaleDateString('en-US', { weekday: 'long' });
  choices.push({ label: `${day} 9 AM`, at: at(next, 9) }, { label: `${day} 2 PM`, at: at(next, 14) });
  if (next === 1) choices.push({ label: 'Next week', at: at((8 - now.getDay()) % 7 || 7, 10) });
  return choices;
}

/** The listing line for today, e.g. "Thursday: 8 AM–5 PM", when the listing has hours. */
export function hoursToday(hours: string[] | null | undefined, now = new Date()) {
  const day = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const line = hours?.find(item => item.toLowerCase().startsWith(day));
  return line ? line.slice(line.indexOf(':') + 1).trim() : null;
}

export function sessionStats(log: SessionEntry[], startedAt: number, now = Date.now()) {
  const count = (outcome: CallOutcome) => log.filter(entry => entry.outcome === outcome).length;
  const connects = count('interested') + count('not_interested') + count('callback');
  const hours = Math.max((now - startedAt) / 3_600_000, 1 / 60);
  return {
    dials: log.length, connects, interested: count('interested'), callbacks: count('callback'), noAnswer: count('no_answer'),
    connectRate: log.length ? Math.round((100 * connects) / log.length) : 0,
    perHour: log.length ? Math.round(log.length / hours) : 0,
  };
}

export function sessionRecap(log: SessionEntry[], startedAt: number, now = Date.now()) {
  const stats = sessionStats(log, startedAt, now);
  const minutes = Math.max(1, Math.round((now - startedAt) / 60000));
  const lines = log.filter(entry => entry.outcome !== 'no_answer').map(entry => `- ${entry.name}: ${OUTCOME_LABEL[entry.outcome]}${entry.callbackAt ? ` (${new Date(entry.callbackAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })})` : ''}`);
  return [`Power Hour · ${minutes} min · ${stats.dials} dials · ${stats.connects} connects (${stats.connectRate}%) · ${stats.interested} interested · ${stats.callbacks} callbacks`, ...lines].join('\n');
}
