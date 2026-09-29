import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareDeals, dealPlan, dealQuestions, laneVerdict } from '../src/lib/swarm/deal-plan.ts';
import { generateDemoResearch } from '../src/lib/demo-data.ts';

const template = generateDemoResearch().prospects[0];
function card(name, category = 'Professional services', extra = {}, business = {}) {
  return {
    id: name, business: { ...template, id: name, name, category, publicNotes: null, address: '100 Main St, Columbia SC', phone: '(803) 555-0100', operatingStatus: 'Open', reviewCount: 40, locationCount: 1, ...business },
    sourceAddressIds: ['a'], clusterId: 'x', rank: 60, opportunity: 'review', broadband: null, broadbandChecked: false,
    intelligence: null, researchStatus: 'listing', error: null, firstSeenAt: '2026-09-01', updatedAt: '2026-09-01', ...extra,
  };
}
const obs = (provider, technology) => ({ id: provider + technology, provider, technology, downloadMbps: null, uploadMbps: null, classification: 'Business', coverageArea: '', source: 'FCC', sourceDate: '', retrievedAt: '', confidence: 'Verified' });
const broadband = (...observations) => ({ broadband: { status: 'available', observations, message: '', sourceUrl: '', asOfDate: null, matchedLocationId: null, matchQuality: 'exact' }, broadbandChecked: true });

test('schools, hospitals, universities, government, apartments and chains are out of lane', () => {
  for (const name of ['Lugoff Elementary School', 'Prisma Health Regional Medical Center', 'University of South Carolina', 'City of Camden Police Department', 'Pinewood Apartments', 'Holiday Inn Express', 'Walmart Supercenter']) {
    assert.equal(laneVerdict(card(name)).status, 'out', name);
    assert.equal(dealPlan(card(name)).score, 0, name);
  }
});

test('misses from real batches: public agencies, junior highs, and brand names inside other words', () => {
  for (const name of ['Johnston Fire Dept', 'Farmersville Water Department', 'Jackson Twp Road Department', 'Johnston Town Hall', 'Mobley (Johnston) Branch Library', 'United States Postal Service', 'Valley View Junior High', 'Johnston Primary School', 'Citi Trends', 'DG Market']) {
    assert.equal(laneVerdict(card(name)).status, 'out', name);
  }
  assert.equal(laneVerdict(card("Shellma's Country Market", 'Hospitality & food')).status, 'clear');
  assert.equal(laneVerdict(card('Johnston Plant - Milliken & Company')).status, 'check');
});

test('a church filed under Medical & dental is pitched as a church, not a clinic', () => {
  const church = dealPlan(card("Doctor's Fork Baptist Church", 'Medical & dental'));
  assert.ok(!church.products.some(p => p.id === 'static_ip' || p.id === 'tv'));
  assert.ok(dealPlan(card('Homecare South, LLC', 'Medical & dental')).drivers.some(d => d.good && /Field crew/.test(d.label)));
});

test('names that only borrow a landmark stay callable but get flagged', () => {
  assert.equal(laneVerdict(card('College Street Pizza', 'Hospitality & food')).status, 'check');
  assert.equal(laneVerdict(card('University Dental Care', 'Medical & dental')).status, 'check');
  assert.equal(laneVerdict(card('Camden Animal Hospital', 'Medical & dental')).status, 'clear');
});

test('lodging asks to confirm 8 rooms or fewer, small studios with "academy" are only flagged', () => {
  const inn = laneVerdict(card('Blue Ridge Cabins & Inn', 'Hospitality & food'));
  assert.equal(inn.status, 'check');
  assert.match(inn.reasons[0], /8 rooms/);
  assert.equal(laneVerdict(card('Tiger Martial Arts Academy')).status, 'check');
  assert.equal(laneVerdict(card('Big Chain Co', 'Retail', {}, { locationCount: 25 })).status, 'out');
});

test('a crew trade gets mobile lines and dispatch, a bar gets TV, Wi-Fi and backup', () => {
  const hvac = dealPlan(card('Smith Heating & Air', 'Construction'));
  assert.deepEqual(hvac.products.map(p => p.id), ['internet', 'mobile', 'connect']);
  assert.match(hvac.bestTime, /7–8:30 AM/);
  const bar = dealPlan(card("Rick's Sports Bar & Grill", 'Hospitality & food'));
  for (const id of ['tv', 'wifi', 'backup', 'voice']) assert.ok(bar.products.some(p => p.id === id), id);
  assert.match(dealQuestions(bar), /Then uncover:\n1\. Business Internet: /);
});

test('DSL-only competition raises the score, a missing Spectrum report sinks it', () => {
  const base = dealPlan(card('Main Street Barber', 'Retail')).score;
  const dsl = dealPlan(card('Main Street Barber', 'Retail', broadband(obs('Charter Communications', 'Cable modem – DOCSIS 3.1'), obs('Brightspeed', 'Asymmetric xDSL')))).score;
  const none = dealPlan(card('Main Street Barber', 'Retail', broadband(obs('Brightspeed', 'Asymmetric xDSL')))).score;
  assert.ok(dsl > base && base > none, `${dsl} > ${base} > ${none}`);
});

test('ranking puts out-of-lane last and bigger bundles first', () => {
  const cards = [card('Lugoff Elementary School'), card('Quiet Consulting'), card('Pro Plumbing & Drain', 'Construction')];
  assert.deepEqual([...cards].sort(compareDeals).map(c => c.id), ['Pro Plumbing & Drain', 'Quiet Consulting', 'Lugoff Elementary School']);
});

test('questions are written for the kind of business, not one script for everyone', () => {
  const pizza = dealPlan(card("Tony's Pizza", 'Hospitality & food'));
  const dental = dealPlan(card('Camden Family Dental', 'Medical & dental'));
  const hvac = dealPlan(card('Smith Heating & Air', 'Construction'));
  assert.equal(pizza.discovery.kind, 'Restaurant or bar');
  assert.equal(dental.discovery.kind, 'Medical and dental');
  assert.equal(hvac.discovery.kind, 'Trades and field crews');
  assert.match(pizza.products[0].ask, /Friday night/);
  assert.match(dental.products[0].ask, /records/);
  assert.match(hvac.products.find(p => p.id === 'mobile').ask, /crew/);
  assert.match(pizza.discovery.gatekeeper, /general manager/);
  assert.notEqual(pizza.discovery.opening[0], dental.discovery.opening[0]);
});

test('every product has follow-ups, every line is a real question, and no placeholder leaks through', () => {
  const samples = [
    card("Tony's Pizza", 'Hospitality & food'), card('Camden Family Dental', 'Medical & dental'), card('Smith Heating & Air', 'Construction'),
    card('Main Street Barber', 'Retail'), card('Quiet Consulting'), card("Doctor's Fork Baptist Church", 'Medical & dental'), card('Blue Ridge Cabins', 'Hospitality & food', {}, { locationCount: 1 }),
    card('Rocky Top Feed & Supply', 'Agriculture & equine'), card('Little Lambs Daycare', 'Education & childcare'), card('Iron Works Fitness', 'Retail'), card('Camden Tire & Auto', 'Automotive'), card('Corner Gift Shop', 'Retail'), card('Anything Co', 'Other'),
  ];
  for (const sample of samples) {
    const plan = dealPlan(sample);
    const all = [...plan.discovery.opening, ...plan.discovery.closing, ...plan.products.flatMap(item => [item.ask, ...item.followUps])];
    assert.equal(plan.discovery.opening.length, 3, sample.id);
    for (const product of plan.products) assert.equal(product.followUps.length, 1, `${sample.id} ${product.id} needs one follow-up`);
    for (const question of all) {
      assert.doesNotMatch(question, /\{(?:name|place)\}/, `${sample.id}: ${question}`);
      assert.ok(question.length > 14 && question.endsWith('?'), question);
      assert.ok(question.split(' ').length <= 18, `too long to say naturally: ${question}`);
      assert.doesNotMatch(question, /walk me through|: /i, `sounds scripted: ${question}`);
    }
    assert.equal(new Set(all).size, all.length, `${sample.id} repeats a question`);
  }
});

test('listing facts add to the opening: multi-site, brand new, home-based', () => {
  assert.match(dealPlan(card('Delta Dental', 'Medical & dental', {}, { locationCount: 4 })).discovery.opening.at(-1), /4 locations/);
  assert.match(dealPlan(card('Fresh Start Bakery', 'Hospitality & food', {}, { reviewCount: 2 })).discovery.opening.at(-1), /How long have you been open/);
});
