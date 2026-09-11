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
  assert.ok(plan.variants.every(query => query.includes('Lugoff')));
  assert.ok(plan.variants.some(query => query.includes('Lugoff, SC')));
  assert.equal(parseLiveBrief('Find Georgia Pacific in Atlanta, Georgia').targetName, 'Georgia Pacific');
});

test('missing secondary facts do not erase a sourced business answer', () => {
  assert.equal(lookupReplyNeedsEvidence('L3 Installer Services builds decks. I could not verify the owner.', 'L3 Installer'), false);
  assert.equal(lookupReplyNeedsEvidence('I could not find L3 Installer in Lugoff.', 'L3 Installer'), true);
  assert.equal(lookupReplyNeedsEvidence('Try L3Harris instead.', 'L3 Installer'), true);
});

test('ordinary category discovery is not mistaken for a named company', () => {
  const landscape = 'find me one for landscape in lugoff that ranks high';
  assert.equal(parseLiveBrief(landscape).targetName, null);
  assert.equal(parseLiveBrief(landscape).locationHint, 'lugoff');
  assert.equal(parseLiveBrief(landscape).requestedCount, 1);
  assert.deepEqual(parseLiveBrief(landscape).searchTerms, ['lawn care service', 'landscaping']);
  assert.equal(isLiveSearchRequest(landscape), true);
  assert.equal(planWebLookup(landscape), null);
  for (const text of ['Find me one for plumbing in Lugoff SC', 'Find a highly rated landscape company in Lugoff SC', 'Find two lawn care businesses in Lugoff SC']) {
    assert.equal(parseLiveBrief(text).targetName, null, text);
    assert.equal(planWebLookup(text), null, text);
    assert.ok(parseLiveBrief(text).searchTerms.every(term => !/one|two|rated/.test(term)));
  }
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

test('possessive and punctuation variants still identify the same shop', () => {
  const listing = {title: "Annas Bakery - Greenville, SC", snippet: 'Annas Bakery bakes bread in Greenville.', url: 'https://annasbakery.example/about'};
  for (const name of ["Anna’s Bakery", "Anna's Bakery", "Annas Bakery"]) {
    assert.equal(matchesLookupName(listing, name, 'Greenville, SC'), true, name);
  }
  assert.equal(matchesLookupName({title:'Home', snippet:'Welcome', url:'https://www.annasbakery.com/'}, "Anna's Bakery", 'Greenville, SC'), true);
  assert.equal(matchesLookupName({title:'Bobs Bakery - Greenville, SC', snippet:'Another bakery', url:'https://bobsbakery.example'}, "Anna's Bakery", 'Greenville, SC'), false);
  assert.equal(matchesLookupName({title:'Annas Bakery - Charlotte, NC', snippet:'Charlotte bakery', url:'https://annasbakery.example/charlotte'}, "Anna's Bakery", 'Greenville, SC'), false);
  assert.equal(matchesLookupName({title:'Annas Bakery - Columbia, SC', snippet:'Columbia bakery', url:'https://annasbakery.example/columbia'}, "Anna's Bakery", 'Greenville, SC'), false);
});

test('named lookup queries retry apostrophe-free and expanded-state forms', () => {
  const plan = planWebLookup("Brief me on Anna’s Bakery in Greenville, South Carolina.");
  assert.equal(plan.name, "Anna’s Bakery");
  assert.equal(plan.location, 'Greenville, SC');
  assert.match(plan.query, /Annas Bakery Greenville, SC/);
  assert.ok(plan.variants.some((query) => query.includes("Anna's Bakery") || query.includes('Annas Bakery')));
  assert.ok(plan.variants.some((query) => /Greenville, South Carolina/.test(query)));
});

test('exact brand + city pages are kept, including first-party URLs that only name the city in the path', () => {
  const loc = 'Travelers Rest, SC';
  const official = {title: 'Travelers Rest, SC', snippet: 'Drive-thru coffee. Open daily.', url: 'https://7brew.com/locations/travelers-rest-sc'};
  assert.equal(matchesLookupName(official, '7 Brew Coffee', loc), true);
  assert.equal(matchesLookupName({title: 'Locations | 7 Brew Coffee', snippet: 'Greenville, SC and Spartanburg, SC locations.', url: 'https://7brew.com/locations'}, '7 Brew Coffee', loc), true);
  assert.equal(matchesLookupName({title: '7 Brew Coffee', snippet: 'Over 1,000 locations nationwide.', url: 'https://7brew.com/'}, '7 Brew Coffee', loc), true);
  assert.equal(matchesLookupName({title: 'Annas Bakery - Columbia, SC', snippet: 'Columbia bakery', url: 'https://annasbakery.example/columbia'}, "Anna's Bakery", 'Greenville, SC'), false);
  const brief = parseLiveBrief('Research the 7 Brew Coffee location in Travelers Rest, South Carolina. I want to know who actually owns or operates this specific location.');
  assert.equal(brief.targetName, '7 Brew Coffee');
  assert.equal(brief.locationHint, loc);
});

test('city-prefixed shop names still match a brand homepage that omits the trade word', () => {
  const homepage = {title: 'Home | Mercantile', snippet: 'Welcome.', url: 'https://www.rivertownmercantile.com/'};
  assert.equal(matchesLookupName(homepage, 'Rivertown Mercantile Deli', 'Rivertown, SC'), true);
  assert.equal(matchesLookupName(homepage, 'Rivertown Bagel Deli', 'Rivertown, SC'), false);
  assert.equal(matchesLookupName({title: 'Home | Deli', snippet: 'A deli in Rivertown, SC', url: 'https://www.anotherrivertowndeli.com/'}, 'Rivertown Deli', 'Rivertown, SC'), true);
  assert.equal(matchesLookupName({title: 'Home | Grill', snippet: 'Welcome.', url: 'https://www.towncentergrill.com/'}, 'Rivertown Deli', 'Rivertown, SC'), false);
  assert.equal(matchesLookupName({title: 'Home | Deli', snippet: 'Welcome.', url: 'https://www.rivertowndeli.com/'}, 'Rivertown Mercantile Deli', 'Rivertown, SC'), false);
  assert.equal(matchesLookupName({title: 'L3Harris Technologies', snippet: 'Lugoff installer services'}, 'L3 Installer'), false);
  const plan = planWebLookup('Brief me on Rivertown Mercantile Deli in Rivertown, South Carolina.');
  assert.equal(plan.name, 'Rivertown Mercantile Deli');
  assert.ok(
    plan.query === 'Mercantile Deli Rivertown, SC' || plan.variants.includes('Mercantile Deli Rivertown, SC'),
    `Expected a city-deduped query, got ${plan.query} / ${JSON.stringify(plan.variants)}`,
  );
});
