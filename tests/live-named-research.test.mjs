import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesBusinessName, mentionsRequestedPlace} from '../src/lib/business-identity.ts';
import {parseLiveBrief, isLiveSearchRequest, researchQuestionLabel} from '../src/lib/live/intent.ts';
import {
  extractOperatorNames,
  formatOwnershipReply,
  isOwnershipLookup,
  planLocationResearchQueries,
  planOperatorResearchQueries,
  runLocationResearch,
  summarizeLocationResearch,
} from '../src/lib/live/named-research.ts';

const QUERY = 'Research the 7 Brew Coffee location in Travelers Rest, South Carolina. I want to know who actually owns or operates this specific location — not just who owns the 7 Brew brand.';
const PLACE = 'Travelers Rest, SC';
const OFFICIAL = {
  title: 'Travelers Rest, SC',
  snippet: 'N Main Street. Drive-thru coffee. Open daily.',
  url: 'https://samplebrand.example/locations/travelers-rest-sc',
};
const LOCATOR = {
  title: 'Locations | Sample Brand Coffee',
  snippet: 'South Carolina locations include Greenville, SC and Spartanburg, SC.',
  url: 'https://samplebrand.example/locations',
};
const HOMEPAGE = {
  title: 'Sample Brand Coffee',
  snippet: 'Over 1,000 locations nationwide. Corporate does not own individual stores.',
  url: 'https://samplebrand.example/',
};
const OPERATOR = {
  title: 'Upstate Drive Thru LLC opens Sample Brand in Travelers Rest',
  snippet: 'Upstate Drive Thru LLC operates the Sample Brand Coffee location in Travelers Rest, SC.',
  url: 'https://upstatetoday.example/sample-brand-opens',
};
const OTHER_CITY = {
  title: 'Annas Bakery - Columbia, SC',
  snippet: 'Columbia bakery',
  url: 'https://annasbakery.example/columbia',
};

test('exact brand + city is a named lookup, not nearby discovery', () => {
  const brief = parseLiveBrief(QUERY);
  assert.equal(brief.targetName, '7 Brew Coffee');
  assert.equal(brief.locationHint, PLACE);
  assert.equal(researchQuestionLabel(QUERY), 'who owns this specific location');
  assert.equal(isOwnershipLookup(QUERY), true);
  assert.equal(isLiveSearchRequest(QUERY), false);
  for (const text of [
    'Who owns the Dunkin in Columbia, SC?',
    'Who operates the Tropical Smoothie in Greenville, SC?',
    'Who owns the Crumbl franchise in Lexington, SC?',
    'Who runs the local car wash location in Lugoff, SC?',
  ]) {
    assert.equal(isOwnershipLookup(text), true, text);
    assert.equal(isLiveSearchRequest(text), false, text);
    assert.ok(parseLiveBrief(text).targetName, text);
    assert.ok(parseLiveBrief(text).locationHint, text);
  }
});

test('first-party location pages match even when the city is only in the URL', () => {
  assert.equal(matchesBusinessName(OFFICIAL, 'Sample Brand Coffee', PLACE), true);
  assert.equal(mentionsRequestedPlace(OFFICIAL, PLACE), true);
  assert.equal(matchesBusinessName({title: '', snippet: '', url: OFFICIAL.url}, 'Sample Brand Coffee'), true);
  assert.equal(matchesBusinessName(LOCATOR, 'Sample Brand Coffee', PLACE), true);
  assert.equal(mentionsRequestedPlace(LOCATOR, PLACE), false);
  assert.equal(matchesBusinessName(OTHER_CITY, "Anna's Bakery", 'Greenville, SC'), false);
  assert.equal(matchesBusinessName({title: 'L3Harris Technologies', snippet: 'Lugoff installer services'}, 'L3 Installer'), false);
});

test('a locator listing sibling cities does not erase the requested store', () => {
  const research = summarizeLocationResearch({
    name: 'Sample Brand Coffee',
    location: PLACE,
    findings: [HOMEPAGE, LOCATOR, OFFICIAL],
  });
  assert.equal(research.locationVerified, true);
  assert.equal(research.brandOnly, false);
  assert.ok(research.firstParty);
  assert.match(research.firstParty.url, /travelers-rest/);
});

test('ownership research continues past the brand and surfaces a local operator', () => {
  const research = summarizeLocationResearch({
    name: 'Sample Brand Coffee',
    location: PLACE,
    findings: [HOMEPAGE, OFFICIAL, OPERATOR],
  });
  assert.equal(research.locationVerified, true);
  assert.equal(research.operator?.name, 'Upstate Drive Thru LLC');
  assert.equal(research.legalEntityVerified, false);
  const reply = formatOwnershipReply(research);
  assert.match(reply, /Verified/);
  assert.match(reply, /Travelers Rest/);
  assert.match(reply, /Upstate Drive Thru LLC/);
  assert.match(reply, /Still not fully verified/);
  assert.match(reply, /exact legal ownership entity/i);
  assert.doesNotMatch(reply, /1,000 locations|corporate does not own/i);
  assert.doesNotMatch(reply, /couldn.t verify|no public record/i);
});

test('brand-only evidence is not treated as “the store does not exist”', () => {
  const research = summarizeLocationResearch({
    name: 'Sample Brand Coffee',
    location: PLACE,
    findings: [HOMEPAGE],
  });
  assert.equal(research.locationVerified, false);
  assert.equal(research.brandOnly, true);
  const reply = formatOwnershipReply(research);
  assert.doesNotMatch(reply, /does not exist|no public record|couldn.t verify/i);
  assert.match(reply, /not the same as confirming this exact/);
  assert.match(reply, /who owns or operates this specific location/);
});

test('operator names come from source language, not the brand itself', () => {
  assert.deepEqual(
    extractOperatorNames('Upstate Drive Thru LLC operates the Sample Brand Coffee location in Travelers Rest.', 'Sample Brand Coffee'),
    ['Upstate Drive Thru LLC'],
  );
  assert.deepEqual(
    extractOperatorNames('Sample Brand Coffee is a franchise brand with 1,000 locations.', 'Sample Brand Coffee'),
    [],
  );
});

test('a weak first search keeps going into operator queries', async () => {
  const calls = [];
  const search = async (queries) => {
    calls.push(queries);
    const operatorRound = queries.some((query) => /franchisee|operator/i.test(query));
    const findings = operatorRound ? [OPERATOR, OFFICIAL] : [HOMEPAGE];
    return {
      findings,
      nearMisses: [],
      queries,
      engine: 'test',
      diagnostics: { queriesCompleted: queries.length, failures: [] },
    };
  };
  const ran = await runLocationResearch(
    { query: 'Sample Brand Coffee Travelers Rest, SC', name: 'Sample Brand Coffee', location: PLACE, variants: ['Sample Brand Travelers Rest'] },
    search,
    { ownership: true },
  );
  assert.ok(calls.length >= 2, `expected retries, got ${calls.length} rounds`);
  assert.ok(calls.some((round) => round.some((query) => /franchisee|operator/i.test(query))));
  assert.ok(calls.every((round) => round.every((query) => /Travelers Rest/i.test(query))));
  assert.equal(ran.research.locationVerified, true);
  assert.equal(ran.research.operator?.name, 'Upstate Drive Thru LLC');
});

test('location and operator query plans stay on the named store', () => {
  const locationQueries = planLocationResearchQueries('Sample Brand Coffee', PLACE);
  const operatorQueries = planOperatorResearchQueries('Sample Brand Coffee', PLACE, ['Upstate Drive Thru LLC']);
  assert.ok(locationQueries.some((query) => /Sample Brand Coffee Travelers Rest/.test(query)));
  assert.ok(operatorQueries.some((query) => /franchisee/i.test(query)));
  assert.ok(operatorQueries.some((query) => /Upstate Drive Thru LLC/.test(query)));
  assert.ok([...locationQueries, ...operatorQueries].every((query) => !/Greenville/i.test(query)));
});
