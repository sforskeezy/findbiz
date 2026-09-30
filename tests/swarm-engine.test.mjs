import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sameBusiness } from '../src/lib/discovery.ts';
import { createSwarm, runSwarm } from '../src/lib/swarm/engine.ts';
import { mutateSwarm, packSwarm, readSwarm, unpackSwarm } from '../src/lib/swarm/store.ts';
import { googleMapsCoolingDown, scrapeGoogleMaps } from '../src/lib/google-maps-scraper.ts';
import { generateDemoResearch } from '../src/lib/demo-data.ts';

let root;
before(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'findbiz-engine-')); process.env.SWARM_STORE_PATH = root; });
after(async () => { await rm(root, { recursive: true, force: true }); });
const fixture = () => generateDemoResearch().prospects[0];
const at = (lat, lng) => ({ lat, lng });
const listing = (name, extra = {}) => ({ ...fixture(), id: name, name, phone: null, website: null, coordinates: at(34.0, -81.03), ...extra });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('chain branches sharing a website or switchboard stay separate; one practice listed twice merges', () => {
  assert.equal(sameBusiness(listing('Moxy Columbia Downtown', { website: 'https://www.marriott.com/a' }), listing('Sheraton Columbia Downtown Hotel', { website: 'https://marriott.com/b' })), false);
  assert.equal(sameBusiness(listing('Smith Family Dental', { phone: '(803) 567-5914' }), listing('Jones Orthodontics', { phone: '803-567-5914' })), false);
  assert.equal(sameBusiness(listing('Joe Lawn Care', { website: 'https://facebook.com/joelawn' }), listing('Joe Lawn Care Services', { website: 'https://facebook.com/other' })), false);
  assert.equal(sameBusiness(listing('Palmetto Dental Services./', { phone: '8032541911' }), listing('Palmetto Dental Services: Furgess Tracie S DDS.', { phone: '(803) 254-1911' })), true);
  assert.equal(sameBusiness(listing('Acme Plumbing LLC'), listing('Acme Plumbing', { coordinates: at(34.001, -81.03) })), true);
  assert.equal(sameBusiness(listing('Acme Plumbing', { id: 'north' }), listing('Acme Plumbing', { id: 'south', coordinates: at(34.05, -81.03) })), false);
});

test('saved snapshots keep one copy of a shared FCC report and read back unchanged', async () => {
  const report = { status: 'available', observations: [{ provider: 'Spectrum', technology: 'Cable', note: 'x'.repeat(300) }], asOfDate: '2021-06-30', matchQuality: 'area_h3' };
  const batch = await createSwarm(['101 Main St, Columbia SC'], 1);
  await mutateSwarm(batch.id, (b) => {
    for (let i = 0; i < 20; i++) b.prospects.push({ id: `c${i}`, business: listing(`Shop ${i}`), sourceAddressIds: [], clusterId: 'x', opportunity: 'review', rank: 0, reasons: [], broadband: structuredClone(report), broadbandChecked: true, intelligence: null, researchStatus: 'listing', error: null, firstSeenAt: '', updatedAt: '' });
  });
  const stored = JSON.parse(await readFile(path.join(root, `${batch.id}.json`), 'utf8'));
  assert.equal(stored.broadbandPool.length, 1);
  const saved = await readSwarm(batch.id);
  assert.equal(saved.broadbandPool, undefined);
  assert.deepEqual(saved.prospects[7].broadband, report);
  const legacy = { ...saved, prospects: saved.prospects.map((card) => ({ ...card })) };
  assert.deepEqual(unpackSwarm(legacy), legacy);
  assert.deepEqual(unpackSwarm(packSwarm(saved)), saved);
});

test('a slow address does not hold back the others, and availability checks start before discovery ends', async () => {
  const batch = await createSwarm(Array.from({ length: 8 }, (_, i) => `${100 + i} Main St, Columbia SC`), 1);
  const events = [];
  let active = 0, maxActive = 0;
  await runSwarm(batch.id, {
    discover: async (address) => {
      active++; maxActive = Math.max(maxActive, active); events.push(`start ${address}`);
      await sleep(address.startsWith('100 ') ? 1_500 : 20);
      active--; events.push(`end ${address}`);
      return { ...generateDemoResearch(), demoMode: false, warnings: [], prospects: [listing(`Biz ${address}`, { distanceMiles: 0.1, coordinates: at(34 + Number(address.slice(0, 3)) / 100, -81) })] };
    },
    broadband: async (p) => { events.push(`fcc ${p.name}`); return { observations: [], matchQuality: 'none' }; },
    research: async () => { throw Error('Not requested'); },
  });
  const saved = await readSwarm(batch.id);
  assert.equal(saved.status, 'complete');
  assert.equal(saved.prospects.length, 8);
  assert.ok(saved.prospects.every((card) => card.broadbandChecked));
  assert.equal(maxActive, 6);
  const slowEnd = events.indexOf('end 100 Main St, Columbia SC');
  assert.ok(events.indexOf('start 107 Main St, Columbia SC') < slowEnd, 'later addresses start while the slow one runs');
  assert.ok(events.findIndex((event) => event.startsWith('fcc ')) < slowEnd, 'availability checks overlap discovery');
});

test('when Google pushes back, Swarm pauses Maps discovery and rechecks the address instead of settling for partial results', async () => {
  const realFetch = globalThis.fetch;
  const batch = await createSwarm(['101 Main St, Columbia SC', '140 Main St, Columbia SC'], 1);
  let calls = 0;
  try {
    globalThis.fetch = async () => new Response('', { status: 429 });
    await runSwarm(batch.id, {
      discover: async () => {
        calls++;
        await scrapeGoogleMaps(at(34, -81), 1, [`probe ${calls}`]).catch(() => {});
        return { ...generateDemoResearch(), demoMode: false, warnings: [], prospects: [listing(`Partial ${calls}`, { distanceMiles: 0.1, coordinates: at(34 + calls / 10, -81) })] };
      },
      broadband: async () => ({ observations: [], matchQuality: 'none' }),
      research: async () => { throw Error('Not requested'); },
    });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(googleMapsCoolingDown(), true);
  const saved = await readSwarm(batch.id);
  assert.equal(saved.status, 'queued');
  assert.ok(saved.addresses.every((address) => address.status === 'pending' && address.blockedRetries === 1));
  assert.ok(saved.prospects.length >= 1, 'partial results are kept');
  assert.ok(saved.warnings.some((warning) => /slow down/.test(warning)));
  const before = calls;
  await runSwarm(batch.id, { discover: async () => { calls++; throw Error('must wait for the cooldown'); }, broadband: async () => ({ observations: [] }), research: async () => ({}) });
  assert.equal(calls, before);
});
