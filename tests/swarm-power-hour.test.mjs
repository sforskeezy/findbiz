import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityFor, callbackChoices, callNote, hoursToday, powerQueue, RETRY_AFTER_MS, sessionRecap, sessionStats } from '../src/lib/swarm/power-hour.ts';
import { dealPlan } from '../src/lib/swarm/deal-plan.ts';
import { generateDemoResearch } from '../src/lib/demo-data.ts';

const template = generateDemoResearch().prospects[0];
const NOW = Date.parse('2026-10-23T15:00:00Z');
function card(name, business = {}) {
  return {
    id: name, business: { ...template, id: name, name, category: 'Professional services', publicNotes: null, address: `${name.length} Main St, Columbia SC`, phone: '(803) 555-0100', locationCount: 1, reviewCount: 40, ...business },
    sourceAddressIds: ['a'], clusterId: 'x', rank: 60, opportunity: 'review', broadband: null, broadbandChecked: false,
    intelligence: null, researchStatus: 'listing', error: null, firstSeenAt: '2026-09-01', updatedAt: '2026-09-01',
  };
}
function lead(target, disposition, activity) {
  return { key: target.id, disposition, card: target, source: { id: 'b', title: 'b', radiusMiles: 1, addresses: [] }, contactName: '', notes: '', createdAt: '', updatedAt: '', ...(activity ? { activity } : {}) };
}
const plansFor = cards => new Map(cards.map(c => [c.id, dealPlan(c)]));

test('the line puts due callbacks first, then never-called leads in the given order, then stale no-answers', () => {
  const fresh1 = card('Acme Roofing'), fresh2 = card('Bright Dental'), retry = card('Cedar CPA'), recentMiss = card('Delta Law Firm');
  const dueLate = card('Echo Salon'), dueEarly = card('Fern Bakery'), later = card('Grove Insurance'), reached = card('Harbor Realty');
  const cards = [fresh1, retry, recentMiss, dueLate, fresh2, dueEarly, later, reached];
  const records = [
    lead(retry, 'active', { outcome: 'no_answer', at: new Date(NOW - RETRY_AFTER_MS - 1000).toISOString() }),
    lead(recentMiss, 'active', { outcome: 'no_answer', at: new Date(NOW - 60_000).toISOString() }),
    lead(dueLate, 'saved', { outcome: 'callback', at: '', callbackAt: new Date(NOW - 60_000).toISOString() }),
    lead(dueEarly, 'saved', { outcome: 'callback', at: '', callbackAt: new Date(NOW - 3_600_000).toISOString() }),
    lead(later, 'saved', { outcome: 'callback', at: '', callbackAt: new Date(NOW + 3_600_000).toISOString() }),
    lead(reached, 'saved', { outcome: 'connected', at: '' }),
  ];
  const queue = powerQueue(cards, records, plansFor(cards), NOW);
  assert.deepEqual(queue.map(item => item.card.id), ['Fern Bakery', 'Echo Salon', 'Acme Roofing', 'Bright Dental', 'Cedar CPA']);
  assert.deepEqual(queue.map(item => item.reason), ['callback_due', 'callback_due', 'fresh', 'fresh', 'retry']);
});

test('leads without a phone, out of lane, or hidden never reach the line', () => {
  const noPhone = card('Ivy Florist', { phone: null }), school = card('Lugoff Elementary School'), hidden = card('Juniper Tire'), ok = card('Kite Plumbing');
  const cards = [noPhone, school, hidden, ok];
  const queue = powerQueue(cards, [lead(hidden, 'hidden')], plansFor(cards), NOW);
  assert.deepEqual(queue.map(item => item.card.id), ['Kite Plumbing']);
});

test('outcomes map onto the saved call activity, keeping interested and not interested apart', () => {
  const at = new Date(NOW), back = new Date(NOW + 86_400_000);
  assert.deepEqual(activityFor('no_answer', at), { outcome: 'no_answer', at: at.toISOString() });
  assert.deepEqual(activityFor('callback', at, back), { outcome: 'callback', at: at.toISOString(), callbackAt: back.toISOString() });
  assert.equal(activityFor('interested', at).result, 'interested');
  assert.equal(activityFor('not_interested', at).outcome, 'connected');
  assert.match(callNote('callback', at, '  ask for Pam  ', back), /Call back for .+ · ask for Pam$/);
  assert.doesNotMatch(callNote('no_answer', at, ''), / · $/);
});

test('callback choices are always in the future and skip "this afternoon" once it has passed', () => {
  const morning = new Date(2026, 9, 23, 10, 0), evening = new Date(2026, 9, 23, 17, 30);
  for (const now of [morning, evening]) for (const choice of callbackChoices(now)) assert.ok(choice.at > now, choice.label);
  assert.ok(callbackChoices(morning).some(choice => choice.label === 'This afternoon'));
  assert.ok(!callbackChoices(evening).some(choice => choice.label === 'This afternoon'));
  const nextWeek = callbackChoices(new Date(2026, 9, 26, 9)).find(choice => choice.label === 'Next week').at;
  assert.equal(nextWeek.getDay(), 1);
  assert.ok(nextWeek > new Date(2026, 9, 26, 9));
});

test('Friday callbacks land on Monday, not the weekend', () => {
  const choices = callbackChoices(new Date(2026, 9, 23, 17, 30));
  assert.ok(choices.every(choice => choice.label === 'In 1 hour' || choice.at.getDay() === 1), choices.map(c => c.label).join());
  assert.ok(choices.some(choice => choice.label === 'Monday 9 AM'));
});

test('today\'s listed hours are picked from the listing', () => {
  const friday = new Date(2026, 9, 23, 12);
  assert.equal(hoursToday(['Thursday: 9 AM–5 PM', 'Friday: 8 AM–4 PM'], friday), '8 AM–4 PM');
  assert.equal(hoursToday(null, friday), null);
});

test('session stats count callbacks as connects and the recap lists only real conversations', () => {
  const log = [
    { id: 'a', name: 'Acme', outcome: 'no_answer', at: 0 },
    { id: 'b', name: 'Bright', outcome: 'interested', at: 0 },
    { id: 'c', name: 'Cedar', outcome: 'callback', at: 0, callbackAt: new Date(NOW).toISOString() },
    { id: 'd', name: 'Delta', outcome: 'not_interested', at: 0 },
  ];
  const stats = sessionStats(log, NOW - 30 * 60_000, NOW);
  assert.equal(stats.dials, 4); assert.equal(stats.connects, 3); assert.equal(stats.connectRate, 75); assert.equal(stats.perHour, 8);
  const recap = sessionRecap(log, NOW - 30 * 60_000, NOW);
  assert.match(recap, /^Power Hour · 30 min · 4 dials · 3 connects \(75%\) · 1 interested · 1 callbacks/);
  assert.doesNotMatch(recap, /Acme/);
  assert.match(recap, /- Bright: Interested/);
});
