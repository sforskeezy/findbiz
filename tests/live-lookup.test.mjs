import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLiveBrief, isLiveSearchRequest} from '../src/lib/live/intent.ts';
import {planWebLookup, matchesLookupName, lookupReplyNeedsEvidence} from '../src/lib/live/lookup.ts';

test('full state names and short brands keep their separate identities', () => {
  for (const text of [
    'Find me L3 Installer, Lugoff, South Carolina. Find me info about it.',
    'Find information about L3 Installer in Lugoff, South Carolina',
    'Google L3 Installer in Lugoff, South Carolina',
  ]) {
    const brief = parseLiveBrief(text);
    assert.equal(brief.targetName, 'L3 Installer', text);
    assert.equal(brief.locationHint, 'Lugoff, SC');
    assert.equal(isLiveSearchRequest(text), false);
  }
  const plan = planWebLookup('Find me L3 Services or whatever. They do decks in Lugoff, South Carolina.');
  assert.equal(plan.name, 'L3 Services');
  assert.ok(plan.variants.some(query => query.includes('decks')));
  assert.ok(plan.variants.every(query => query.includes('Lugoff, SC')));
  assert.equal(parseLiveBrief('Find Georgia Pacific in Atlanta, Georgia').targetName, 'Georgia Pacific');
});

test('missing secondary facts do not erase a sourced business answer', () => {
  assert.equal(lookupReplyNeedsEvidence('L3 Installer Services builds decks. I could not verify the owner.', 'L3 Installer'), false);
  assert.equal(lookupReplyNeedsEvidence('I could not find L3 Installer in Lugoff.', 'L3 Installer'), true);
  assert.equal(lookupReplyNeedsEvidence('Try L3Harris instead.', 'L3 Installer'), true);
});

test('ordinary category discovery is not mistaken for a named company', () => {
  for (const text of ['Find plumbers in Lugoff, South Carolina', 'Find 3 home-based businesses in Charlotte, North Carolina', 'Find deck builders in Lugoff, SC']) {
    assert.equal(parseLiveBrief(text).targetName, null, text);
    assert.equal(isLiveSearchRequest(text), true, text);
  }
  assert.equal(planWebLookup('Google it'), null);
  assert.equal(planWebLookup('Different subject: help me sound natural'), null);
});

test('distinctive whole words reject an unrelated large company', () => {
  assert.equal(matchesLookupName({title:'L3Harris Technologies',snippet:'Lugoff installer services'}, 'L3 Installer'), false);
  assert.equal(matchesLookupName({title:'L3 Installer Services, LLC',snippet:'Decks in Lugoff SC'}, 'L3 Services'), true);
  assert.equal(matchesLookupName({title:"Macon’s Lawn and Landscape",snippet:''}, 'macons lawn and lanscape company'), true);
});
