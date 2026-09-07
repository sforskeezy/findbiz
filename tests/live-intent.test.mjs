import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveBrief, resolveLiveTurn, isLiveNext, extractLiveLocation } from '../src/lib/live/intent.ts';

const previous = parseLiveBrief('Find 3 home-based businesses in Lugoff, SC and research them and check what is new');
const context = { locationLabel: 'Lugoff, SC' };

for (const message of ['How do I sound more natural on calls?', 'Why do businesses need backup internet?', 'Explain what fiber is', 'Different subject: help me plan my afternoon', 'Thanks', 'Make it shorter', 'Next question: what is a good opener?', 'Find the mistake in your last answer', 'Look in the chat above']) {
  test(`conversation is not a search: ${message}`, () => {
    const turn = resolveLiveTurn(message, previous, context);
    assert.equal(turn.search, false);
    assert.equal(turn.brief.wantsNews, false);
    assert.equal(turn.brief.wantsResearch, false);
  });
}

test('a ZIP answer completes every clause of a pending search', () => {
  const pending = parseLiveBrief('Find 3 home-based businesses and research them and check what is new');
  const turn = resolveLiveTurn('29078 is the ZIP', pending, { awaitingLocation: true });
  assert.equal(turn.search, true);
  assert.equal(turn.brief.locationHint, '29078');
  assert.equal(turn.brief.profile, 'home_based');
  assert.equal(turn.brief.requestedCount, 3);
  assert.equal(turn.brief.wantsResearch, true);
  assert.equal(turn.brief.wantsNews, true);
});

test('new trade releases old filters, count and actions, keeping territory', () => {
  const turn = resolveLiveTurn('Actually dentists instead', previous, context);
  assert.equal(turn.search, true);
  assert.equal(turn.brief.locationHint, 'Lugoff, SC');
  assert.deepEqual(turn.brief.searchTerms, ['dentist']);
  assert.equal(turn.brief.profile, 'any');
  assert.equal(turn.brief.requestedCount, null);
  assert.equal(turn.brief.wantsNews, false);
});

test('a new search with a trade and location replaces the earlier brief', () => {
  const turn = resolveLiveTurn('Find plumbers in Columbia, SC', previous, context);
  assert.equal(turn.search, true);
  assert.equal(turn.brief.locationHint, 'Columbia, SC');
  assert.ok(turn.brief.searchTerms.includes('plumber'));
  assert.equal(turn.brief.profile, 'any');
});

test('a location correction keeps search filters without replaying completed actions', () => {
  const turn = resolveLiveTurn('29201', previous, context);
  assert.equal(turn.brief.locationHint, '29201');
  assert.equal(turn.brief.profile, 'home_based');
  assert.equal(turn.brief.wantsNews, false);
});

test('explicit reset drops the list context', () => {
  const turn = resolveLiveTurn('Start over', previous, context);
  assert.equal(turn.reset, true);
  assert.equal(turn.search, false);
});

test('retry preserves active search', () => {
  const turn = resolveLiveTurn('Try again', previous, context);
  assert.equal(turn.search, true);
  assert.equal(turn.brief.profile, 'home_based');
});

test('no chains means exclusion, not inclusion', () => {
  for (const text of ['no chains', 'not a chain', 'skip national chains', 'without chains']) {
    assert.equal(parseLiveBrief(text).askedForChains, false, text);
    assert.equal(parseLiveBrief(text).excludeNational, true, text);
  }
  assert.equal(parseLiveBrief('include chains').askedForChains, true);
});

test('quoted business and conversational references are not locations', () => {
  for (const text of ['Look in the chat', 'What is in the list?', 'Tell me about "Macon Lawn Care"', 'Help me', 'Thanks']) assert.equal(extractLiveLocation(text), null, text);
  assert.equal(extractLiveLocation('Lugoff SC lawn care'), 'Lugoff, SC');
});

test('next question does not advance the queue', () => {
  assert.equal(isLiveNext('Next question: help me with an opener'), false);
  assert.equal(isLiveNext('Next one'), true);
  assert.equal(isLiveNext('Skip to the next one'), true);
});

test('google this is a web lookup, not a new business search', () => {
  const turn = resolveLiveTurn('Google who owns Spectrum in Lugoff SC', previous, context);
  assert.equal(turn.search, false);
  assert.equal(turn.brief.wantsWeb, true);
  assert.match(turn.brief.webQueries[0] || '', /spectrum/i);
});

test('google a named company is a web lookup, not a failed maps list', () => {
  const turn = resolveLiveTurn(
    'google and find a company im looking for in lugoff sc named macons lawn and lanscape company',
    null,
    {},
  );
  assert.equal(turn.search, false);
  assert.equal(turn.brief.wantsWeb, true);
  assert.match(turn.brief.targetName || turn.brief.searchTerms.join(' '), /macon/i);
});

test('find plus google keeps both clauses', () => {
  const turn = resolveLiveTurn('Find plumbers in Columbia, SC and also google their hours', previous, context);
  assert.equal(turn.search, true);
  assert.equal(turn.brief.wantsWeb, true);
  assert.match(turn.brief.webQueries[0] || '', /hours/i);
});

test('counts and shorthand work for specific trades', () => {
  assert.equal(parseLiveBrief('Find 2 dentists in Greenville SC').requestedCount, 2);
  assert.equal(parseLiveBrief('Find a plumber near Lugoff SC').requestedCount, 1);
  assert.equal(resolveLiveTurn('Lugoff SC lawn care', null, {}).search, true);
});
