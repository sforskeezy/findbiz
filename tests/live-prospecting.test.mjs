import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareOutreach} from '../src/lib/live/prospecting.ts';
import {filterProspectsForBrief} from '../src/lib/live/filters.ts';
import {generateDemoResearch} from '../src/lib/demo-data.ts';

const prospect = {...generateDemoResearch().prospects[0], id:'home-test', name:'Example Deck Services', category:'Construction', address:'10 Maple Lane, Lugoff, SC', publicNotes:'A home-based deck builder.', reviewCount:5, locationCount:1, operatingStatus:'Open'};

test('a home-based shortlist stays short instead of adding weaker independents', () => {
  const other = {...prospect, id:'other', name:'Example Crafts', category:'Professional services', publicNotes:null, address:'11 Maple Lane, Lugoff, SC'};
  const result = filterProspectsForBrief([prospect,other], {profile:'home_based', excludeNational:true});
  assert.deepEqual(result.kept.map(item => item.id), ['home-test']);
  assert.equal(result.relaxed, false);
  assert.equal(result.kept[0].signals.find(signal => signal.kind === 'home').label, 'Possibly home-based');
});

test('outreach qualifies the operating location and needs without inventing an offer', () => {
  const result = prepareOutreach({...prospect, callOpener:'You qualify for a guaranteed discount!', followUpEmail:{subject:'Guaranteed savings',body:'We already serve your home.'}});
  assert.match(result.callOpener, /customer calls, quotes, and scheduling/);
  assert.doesNotMatch(result.callOpener + result.followUpEmail.body, /guaranteed|qualify|already serve|work from home/i);
  assert.match(result.qualification.homeBased, /Possible/);
  assert.ok(result.qualification.questions.some(question => question.includes('from home')));
  assert.ok(result.qualification.beforeQuoting.some(item => item.includes('new-customer eligibility')));
});
