import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLiveBrief, isLiveSearchRequest, repairSelfCorrection} from '../src/lib/live/intent.ts';
import {
  isLookupClarification,
  pendingFromLookup,
  resolveLookupClarification,
  suggestNameCorrection,
} from '../src/lib/live/clarify.ts';
import {matchesLookupName, planNamedLookup} from '../src/lib/live/lookup.ts';
import {nameVariants} from '../src/lib/business-identity.ts';

const ORIGINAL = 'Find me information about who owns the Seven Bree and Travelers Rest, South Carolina.';

function pendingFor(request, suggestion = null) {
  const brief = parseLiveBrief(request);
  return pendingFromLookup({name: brief.targetName, location: brief.locationHint, request, suggestion});
}

test('a business named beside a city is not parsed as a four-word city', () => {
  const brief = parseLiveBrief(ORIGINAL);
  assert.equal(brief.targetName, 'Seven Bree');
  assert.equal(brief.locationHint, 'Travelers Rest, SC');
  assert.equal(brief.wantsResearch, true);
  assert.equal(isLiveSearchRequest(ORIGINAL), false);
  const owns = parseLiveBrief('Research who owns 7 Brew in Travelers Rest, SC');
  assert.equal(owns.targetName, '7 Brew');
  assert.equal(owns.locationHint, 'Travelers Rest, SC');
});

test('a short name correction keeps the question and the place it belongs to', () => {
  const pending = pendingFor(ORIGINAL, '7 Brew Coffee');
  for (const reply of ['7brew', 'I mean 7 Brew', 'Seven Brew', 'no, 7 Brew Coffee', '7 Brew Coffee']) {
    const resolved = resolveLookupClarification(reply, pending);
    assert.ok(resolved, reply);
    assert.match(resolved.name, /brew/i, reply);
    assert.equal(resolved.location, 'Travelers Rest, SC', reply);
    assert.equal(resolved.question, 'who owns this specific location', reply);
    assert.equal(resolved.request, ORIGINAL, reply);
  }
});

test('a descriptor or a location refinement clarifies the same target', () => {
  const pending = pendingFor(ORIGINAL, '7 Brew Coffee');
  const descriptor = resolveLookupClarification('the coffee place', pending);
  assert.equal(descriptor.name, '7 Brew Coffee');
  assert.equal(descriptor.location, 'Travelers Rest, SC');
  assert.equal(descriptor.descriptor, 'coffee place');
  const refined = resolveLookupClarification('Travelers Rest location', pending);
  assert.equal(refined.location, 'Travelers Rest, SC');
  assert.equal(refined.question, 'who owns this specific location');
});

test('a clarification never turns into a nearby-business search', () => {
  const pending = pendingFor(ORIGINAL, '7 Brew Coffee');
  for (const reply of ['7brew', 'the coffee place', 'Joe’s Coffee House']) {
    assert.equal(isLiveSearchRequest(reply), false, reply);
    assert.ok(isLookupClarification(reply, pending), reply);
  }
  for (const genuine of [
    'Find coffee shops in Greenville, SC',
    'Find 5 home-based businesses in Greenville, SC',
    'Find deck builders in Lugoff, SC',
    'Show me prospects near 29615',
  ]) {
    assert.equal(isLookupClarification(genuine, pending), false, genuine);
    assert.equal(resolveLookupClarification(genuine, pending), null, genuine);
    assert.equal(isLiveSearchRequest(genuine), true, genuine);
  }
});

test('ordinary conversation and commands are not name corrections', () => {
  const pending = pendingFor(ORIGINAL, '7 Brew Coffee');
  for (const other of [
    'thanks',
    'How do I open the call?',
    'What should I ask them?',
    'Write me an email',
    '/livemode',
    'start over',
    'try again',
    'skip',
  ]) {
    assert.equal(isLookupClarification(other, pending), false, other);
  }
  assert.equal(resolveLookupClarification('7brew', null), null);
});

test('a clarification inherits the location without a pending place of its own', () => {
  const pending = pendingFor("Who owns Joe's Coffee in Columbia, SC?");
  assert.equal(pending.location, 'Columbia, SC');
  assert.equal(pending.question, 'who owns this specific location');
  const resolved = resolveLookupClarification("Joe's Coffee House", pending);
  assert.equal(resolved.name, "Joe's Coffee House");
  assert.equal(resolved.location, 'Columbia, SC');
  assert.equal(resolved.request, "Who owns Joe's Coffee in Columbia, SC?");
  // A new place in the correction wins over the remembered one.
  const moved = resolveLookupClarification("Joe's Coffee House in Lexington, SC", pending);
  assert.equal(moved.location, 'Lexington, SC');
  assert.match(moved.name, /Joe/);
  // A bare place corrects where, not who.
  const placeOnly = resolveLookupClarification('Lexington, SC', pending);
  assert.equal(placeOnly.location, 'Lexington, SC');
  assert.equal(placeOnly.name, "Joe's Coffee");
});

test('spelling, spacing, and spoken numerals identify one business', () => {
  const listing = {title: '7 Brew Coffee - Travelers Rest, SC', snippet: '7 Brew Coffee drive-thru in Travelers Rest.', url: 'https://7brew.example/travelers-rest'};
  for (const name of ['7 Brew', '7brew', 'Seven Brew', 'Seven Brew Coffee', '7 Brew Coffee']) {
    assert.equal(matchesLookupName(listing, name, 'Travelers Rest, SC'), true, name);
  }
  assert.equal(matchesLookupName({title: 'Dutch Bros Coffee - Travelers Rest, SC', snippet: 'Coffee drive-thru.'}, '7 Brew', 'Travelers Rest, SC'), false);
  assert.equal(matchesLookupName({title: 'L3Harris Technologies', snippet: 'Lugoff installer services'}, 'L3 Installer'), false);
  assert.ok(nameVariants('7brew').includes('7 Brew') || nameVariants('7brew').includes('7 brew'));
  assert.ok(nameVariants('Seven Brew').some((item) => /7 Brew/i.test(item)));
  const plan = planNamedLookup('7brew', 'Travelers Rest, SC', ['coffee place']);
  assert.match(plan.query, /Travelers Rest, SC/);
  assert.ok(plan.variants.some((query) => /7 brew/i.test(query)));
  assert.ok(plan.variants.some((query) => /coffee place/i.test(query)));
});

test('the closest public spelling is offered instead of a guess', () => {
  const findings = [
    {title: '7 Brew Coffee | Travelers Rest, SC', snippet: 'Drive-thru coffee.'},
    {title: 'Starbucks - Travelers Rest', snippet: 'Coffee.'},
  ];
  assert.equal(suggestNameCorrection('Seven Bree', findings, 'Travelers Rest, SC'), '7 Brew Coffee');
  assert.equal(suggestNameCorrection('Seven Bree', [{title: 'Travelers Rest Chamber of Commerce', snippet: 'Local business directory.'}], 'Travelers Rest, SC'), null);
  assert.equal(suggestNameCorrection('7 Brew Coffee', findings, 'Travelers Rest, SC'), null);
});

test('a spoken correction keeps only the value the rep landed on', () => {
  assert.match(repairSelfCorrection('lets search in 2960- oh wait no actually lets search in 29615'), /^(?:lets )?search in 29615$/);
  assert.equal(repairSelfCorrection('search in 2960 wait no 29615'), 'search in 29615');
  assert.equal(repairSelfCorrection('find plumbers in Columbia, SC, actually no, Lexington, SC'), 'find plumbers in Lexington, SC');
  assert.equal(parseLiveBrief('Find me lawn care in 2960- I mean 29615').locationHint, '29615');
  // A turn that merely opens with a correction word is still an ordinary follow-up.
  assert.equal(repairSelfCorrection('Actually 29078'), 'Actually 29078');
  assert.equal(repairSelfCorrection('Actually make it dentists instead'), 'Actually make it dentists instead');
  assert.equal(repairSelfCorrection('Find plumbers in Lugoff, SC'), 'Find plumbers in Lugoff, SC');
  assert.equal(repairSelfCorrection('7brew'), '7brew');
});
