import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiWebSearch, callBrief, collectPeople, contactQueries, extractPeople, mergePeople } from '../src/lib/swarm/contact-research.ts';
import { lookupLinks, splitAddress } from '../src/lib/swarm/lookup-links.ts';

const prospect = { id: 'p1', name: 'Carolina Pest Pros', address: '46 Carina Ln, Lugoff, SC 29078', phone: '(803) 555-1234', category: 'Pest control', rating: 4.8, reviewCount: 120 };

test('contact queries cover registries, social, and reverse phone', () => {
  const queries = contactQueries(prospect);
  assert.ok(queries.some(q => q.startsWith('site:bizapedia.com')));
  assert.ok(queries.some(q => q.startsWith('site:linkedin.com')));
  assert.ok(queries.includes('"803-555-1234"'));
  assert.ok(queries.some(q => q.includes('owner') && q.includes('Lugoff SC')));
});

test('people are only taken when a role or ownership phrase names them', () => {
  const found = extractPeople('Mike Dawson - Owner - Carolina Pest Pros | LinkedIn. Owned by Sarah Lee since 2009. Call Today Now for Service. Registered Agent: Tom Hart. Contact Us Today', 'Carolina Pest Pros');
  assert.deepEqual(found.map(p => `${p.name}:${p.role}`).sort(), ['Mike Dawson:Owner', 'Sarah Lee:Owner', 'Tom Hart:Registered Agent']);
  assert.deepEqual(extractPeople('Owner Carolina Pest Pros serves Lugoff', 'Carolina Pest Pros'), []);
  assert.deepEqual(extractPeople('the owner Monday Friday hours', 'Carolina Pest Pros'), []);
});

test('the same person across sites is merged and ranked first', () => {
  const people = collectPeople([
    { url: 'https://www.linkedin.com/in/mike', title: 'Mike Dawson - Owner - Carolina Pest Pros', text: '' },
    { url: 'https://www.bizapedia.com/sc/carolina-pest-pros.html', title: 'Carolina Pest Pros LLC', text: 'The registered agent on file for this company is Mike Dawson.' },
    { url: 'https://example.com/a', title: 'Review', text: 'Manager Jen Ortiz was great' },
  ], 'Carolina Pest Pros');
  assert.equal(people[0].name, 'Mike Dawson');
  assert.deepEqual(people[0].roles, ['Owner', 'Registered Agent']);
  assert.equal(people[0].sources.length, 2);
  assert.equal(people[0].confidence, 'Verified');
  assert.equal(people[1].confidence, 'Estimated');
});

test('the call brief cannot name someone who is not in the evidence', async () => {
  const people = [{ name: 'Mike Dawson', roles: ['Owner'], sources: [], confidence: 'Verified' }];
  const invented = await callBrief(prospect, people, [], async () => ({ askFor: 'Bob Invented', reason: 'x', summary: 'Pest control in Lugoff.', talkingPoints: ['120 reviews at 4.8'] }));
  assert.equal(invented.askFor, null);
  const real = await callBrief(prospect, people, [], async () => ({ askFor: 'mike dawson', reason: 'Listed owner', summary: 'Pest control.', talkingPoints: [] }));
  assert.equal(real.askFor, 'Mike Dawson');
  assert.equal(await callBrief(prospect, people, [], async () => null), null);
});

test('lookup links prefill people-search sites from the listing', () => {
  assert.deepEqual(splitAddress('46 Carina Ln, Lugoff, SC 29078'), { street: '46 Carina Ln', city: 'Lugoff', state: 'SC', zip: '29078' });
  const links = lookupLinks(prospect, ['Mike Dawson']);
  const url = id => links.find(link => link.id === id)?.url;
  assert.equal(url('tps-phone'), 'https://www.truepeoplesearch.com/resultphone?phoneno=8035551234');
  assert.equal(url('fps-phone'), 'https://www.fastpeoplesearch.com/803-555-1234');
  assert.equal(url('fps-address'), 'https://www.fastpeoplesearch.com/address/46-carina-ln_lugoff-sc-29078');
  assert.match(url('tps-mike-dawson'), /results\?name=Mike%20Dawson&citystatezip=Lugoff%2C%20SC/);
});

test('model web search keeps only sourced people and confirms repeats', async () => {
  const found = await aiWebSearch(prospect, async () => ({
    people: [{ name: 'Mike Dawson', role: 'owner', source: 'https://www.bizapedia.com/sc/carolina-pest-pros.html' }, { name: 'Jane Nosource', role: 'owner' }, { name: 'Carolina Pest', role: 'owner', source: 'https://x.com' }],
    facts: [{ text: 'Filed in 2009 as an LLC.', source: 'https://opencorporates.com/c/1' }, 'unsourced claim'],
  }));
  assert.deepEqual(found.people.map(p => p.name), ['Mike Dawson']);
  assert.equal(found.documents.length, 1);
  const merged = mergePeople([{ name: 'Mike Dawson', roles: ['Owner'], sources: [{ label: 'linkedin.com', url: 'https://linkedin.com/in/m', snippet: '' }], confidence: 'Estimated' }], found.people);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].confidence, 'Verified');
  assert.deepEqual(await aiWebSearch(prospect, async () => null), { people: [], documents: [] });
});
