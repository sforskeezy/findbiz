import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runLiveTurn, shouldRejectUngroundedDiscovery } from '../src/lib/live/engine.ts';
import { createSession, saveSession, loadSession, loadMemory } from '../src/lib/live/store.ts';
import { parseLiveBrief } from '../src/lib/live/intent.ts';
import { generateDemoResearch } from '../src/lib/demo-data.ts';
import { POST } from '../src/app/api/live/chat/route.ts';
import { GET as getOutput } from '../src/app/api/live/output/route.ts';
import { POST as postCoach } from '../src/app/api/live/coach/route.ts';
import { formatCoachSummary, startCallCoach, applyRepUtterance } from '../src/lib/live/call-coach.ts';

let root;
const realFetch = globalThis.fetch;
let requests;
let responseText;
let respond;
let webResults;
let webRequests;
const encoder = new TextEncoder();

function streamReply(content) {
  return new Response(`data: ${JSON.stringify({choices: [{delta: {content}}]})}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'findbiz-live-tests-'));
  process.env.LIVE_STORE_PATH = root;
  process.env.GROQ_API_KEY = 'test-only';
  process.env.DASHSCOPE_API_KEY = '';
  process.env.LIVE_BASE_URL = 'https://model.test/v1';
  process.env.GOOGLE_SEARCH_API_KEY = 'test-only';
  process.env.GOOGLE_SEARCH_ENGINE_ID = 'test-only';
  process.env.ENABLE_GOOGLE_SEARCH_SCRAPER = 'false';
  process.env.ENABLE_BING_SEARCH_FALLBACK = 'false';
  process.env.ENABLE_KEYLESS_WEB_SEARCH_FALLBACK = 'false';
});

after(async () => { globalThis.fetch = realFetch; await rm(root, { recursive: true, force: true }); });
beforeEach(() => {
  requests = [];
  webRequests = [];
  webResults = [];
  responseText = 'Start with a short introduction and one useful question.';
  respond = () => streamReply(responseText);
  globalThis.fetch = async (url, init) => {
    if (new URL(url).hostname === 'customsearch.googleapis.com') {
      webRequests.push(new URL(url).searchParams.get('q'));
      return Response.json({items: webResults});
    }
    assert.equal(String(url), 'https://model.test/v1/chat/completions', `Unexpected lookup: ${url}`);
    const body = JSON.parse(init.body);
    requests.push(body);
    return respond(body, init);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function seededChat() {
  const session = await createSession();
  session.queue = { locationLabel: 'Charlotte, NC', radiusMiles: 1, category: null, currentIndex: 0, prospects: generateDemoResearch().prospects.slice(0, 3) };
  session.brief = parseLiveBrief('Find 3 home-based businesses in Charlotte, NC and research them and check what is new');
  session.messages = [{ id: 'test_message', role: 'assistant', content: 'Here is your list.', createdAt: new Date().toISOString() }];
  await saveSession(session);
  return session;
}

async function seededChatAt(address) {
  const session = await seededChat();
  session.queue.prospects[0] = { ...session.queue.prospects[0], address };
  await saveSession(session);
  return session;
}

test('topic changes use the model, do not run stale research, and preserve the list', async () => {
  const session = await seededChat();
  const state = await runLiveTurn({ sessionId: session.id, message: 'Different subject: how do I sound natural on a cold call?' });
  assert.equal(state.session.messages.at(-1).content, responseText);
  assert.equal(requests.length, 1);
  assert.equal(state.queue.currentIndex, 0);
  assert.equal(state.session.messages.at(-1).thinking, undefined);
  const prompt = requests[0].messages[0].content;
  assert.match(prompt, /newest message decides the topic/);
  assert.doesNotMatch(prompt.split('Only actions requested for THIS turn:')[1].split('Remembered facts:')[0], /scan local news|research the ones/);
  const saved = await loadSession(session.id);
  assert.equal(saved.brief.wantsNews, false);
});

test('short valid answers are not replaced with a business pitch', async () => {
  const session = await seededChat();
  responseText = 'Yes';
  const state = await runLiveTurn({ sessionId: session.id, message: 'Can we switch subjects?' });
  assert.equal(state.session.messages.at(-1).content, 'Yes');
});

test('thinking shows progress without placing raw model deliberation under a search step', async () => {
  respond = () => new Response([
    `data: ${JSON.stringify({choices:[{delta:{reasoning_content:'Internal deliberation fragment'}}]})}\n\n`,
    `data: ${JSON.stringify({choices:[{delta:{content:'Ask one clear question and listen.'}}]})}\n\n`,
    'data: [DONE]\n\n',
  ].join(''), {headers:{'Content-Type':'text/event-stream'}});
  const state = await runLiveTurn({message:'How can I make my opening question clearer?'});
  const steps = state.session.messages.at(-1).thinking;
  assert.ok(steps.some(step => step.label === 'Preparing a reply'));
  assert.ok(steps.every(step => !step.thought));
  assert.equal(state.session.messages.at(-1).content, 'Ask one clear question and listen.');
});

test('numbered advice without a queue is not treated as invented businesses', async () => {
  responseText = '1. **Listen first** — ask a question.\n2. **Keep it short** — give them room to answer.';
  const state = await runLiveTurn({ message: 'Give me two tips for talking to people.' });
  assert.equal(state.session.messages.at(-1).content, responseText);
});

test('a sourced google writeup is not replaced with a failed listings message', () => {
  const writeup = '1. **Macon Lawn** is in Lugoff.\n2. **Macon Jackson** owns it.';
  assert.equal(shouldRejectUngroundedDiscovery(writeup, { discoverySearch: true, listingCount: 0, sourceCount: 7 }), false);
  assert.equal(shouldRejectUngroundedDiscovery(writeup, { discoverySearch: false, listingCount: 0, sourceCount: 0 }), false);
  assert.equal(
    shouldRejectUngroundedDiscovery('1. **Acme Legal** — 0.4 mi\n2. **Bright Dental** — no public phone', {
      discoverySearch: true,
      listingCount: 0,
      sourceCount: 0,
    }),
    true,
  );
});

test('google a named company keeps the model answer instead of a maps miss', async () => {
  webResults = [{title: 'Macon Lawn and Landscape Company', link: 'https://example.com/macon', snippet: 'Macon Lawn and Landscape Company serves Lugoff, SC.'}];
  responseText = 'I found **Macon Lawn and Landscape Company** in Lugoff from [its listing](https://example.com/macon).';
  const state = await runLiveTurn({
    message: 'google and find a company im looking for in lugoff sc named macons lawn and lanscape company',
  });
  assert.match(state.session.messages.at(-1).content, /Macon Lawn/);
  assert.doesNotMatch(state.session.messages.at(-1).content, /couldn’t verify matching listings/);
  assert.ok(webRequests.length > 0, 'A model answer alone is not evidence of a lookup');
  assert.ok(requests[0].messages.some(message => message.role === 'tool' && message.content.includes('example.com/macon')));
});

test('named business lookup searches without trusting the model to request a tool', async () => {
  webResults = [{title: 'L3 Installer Services', link: 'https://example.com/l3', snippet: 'Decks and screen enclosures in Lugoff, SC.'}];
  responseText = 'I could not find that business. Try L3Harris.';
  const state = await runLiveTurn({message: 'Find me L3 Installer in Lugoff, South Carolina. Find me info about it.'});
  assert.match(webRequests[0], /^L3 Installer Lugoff, SC$/);
  assert.match(state.session.messages.at(-1).content, /L3 Installer Services/);
  assert.doesNotMatch(state.session.messages.at(-1).content, /L3Harris/);
  assert.equal(state.queue, null);
  assert.equal(state.session.messages.at(-1).sources[0].url, 'https://example.com/l3');
});

test('briefing a city-named shop accepts the brand homepage even when the title omits the trade word', async () => {
  webResults = [{
    title: 'Home | Mercantile',
    link: 'https://www.rivertownmercantile.com/',
    snippet: 'Welcome to Mercantile in Rivertown.',
  }];
  const state = await runLiveTurn({
    message: "Brief me on Rivertown Mercantile Deli in Rivertown, South Carolina. I’m about to cold call them. Tell me what you actually verified about this specific business, what you’re only inferring, what you still don’t know, and the single best opening move. Don’t force a sales angle if the evidence doesn’t support one.",
  });
  const answer = state.session.messages.at(-1).content;
  assert.ok(webRequests.some((query) => /Mercantile Deli Rivertown/.test(query) || /Rivertown Mercantile Deli/.test(query)), `Lookups were ${JSON.stringify(webRequests)}`);
  assert.doesNotMatch(answer, /couldn.t verify a matching result/i);
  assert.match(answer, /What I verified/);
  assert.match(answer, /Mercantile/);
  assert.doesNotMatch(answer, /connectivity pain|often face/i);
  assert.equal(requests.length, 0, 'A successful named brief should not wait on the model');
});

test('briefing a named shop with apostrophes uses public evidence instead of a miss', async () => {
  webResults = [{
    title: 'Annas Bakery - Greenville, SC',
    link: 'https://annasbakery.example',
    snippet: 'Annas Bakery is a bakery in Greenville, SC.',
  }];
  const state = await runLiveTurn({
    message: "Brief me on Anna\u2019s Bakery in Greenville, South Carolina. I\u2019m about to cold call them. Tell me what you actually found about this specific company, what you\u2019re only inferring, what you still don\u2019t know, and the single best way I should approach the call.",
  });
  const answer = state.session.messages.at(-1).content;
  assert.ok(webRequests.some((query) => /Annas Bakery/.test(query)), `Lookups were ${JSON.stringify(webRequests)}`);
  assert.doesNotMatch(answer, /couldn.t verify a matching result/i);
  assert.match(answer, /What I verified/);
  assert.match(answer, /Annas Bakery|Anna/);
  assert.match(answer, /What I don.t know|infer/i);
  assert.doesNotMatch(answer, /connectivity pain|often face/i);
  assert.equal(requests.length, 0, 'A successful named brief should not wait on the model');
});

test('just Google it retries the user’s business, not the assistant’s unrelated guess', async () => {
  const session = await seededChat();
  session.messages = [
    {id:'u', role:'user', content:'Find me L3 Services or whatever. They do decks in Lugoff, South Carolina.', createdAt:new Date().toISOString()},
    {id:'a', role:'assistant', content:'The closest match is L3Harris.', createdAt:new Date().toISOString()},
  ];
  await saveSession(session);
  webResults = [{title:'L3 Installer Services', link:'https://example.com/l3', snippet:'Lugoff SC deck builder.'}];
  responseText = 'L3 Installer Services builds decks in Lugoff, SC.';
  await runLiveTurn({sessionId:session.id, message:'Dude just Google it'});
  assert.match(webRequests[0], /L3 Services.*Lugoff, SC/);
  assert.ok(webRequests.every(query => !query.includes('L3Harris')));
  const count = webRequests.length;
  await runLiveTurn({sessionId:session.id, message:'Try again'});
  assert.ok(webRequests.length > count, 'Retry must search again instead of replaying a cache');
  const repeated = await runLiveTurn({sessionId:session.id, message:'Try again'});
  assert.equal(repeated.queue.currentIndex, 0);
  assert.match(webRequests.at(-1), /L3 Services/);
  assert.match(webRequests.at(-1), /Lugoff/);
});

test('no named match never substitutes the old queue or calls the model with invented evidence', async () => {
  const session = await seededChat();
  webResults = [{title:'L3Harris Technologies', link:'https://example.com/unrelated', snippet:'Lugoff SC services'}];
  const state = await runLiveTurn({sessionId:session.id, message:'Find L3 Installer in Lugoff, South Carolina'});
  assert.match(state.session.messages.at(-1).content, /couldn’t confidently resolve \*\*L3 Installer\*\*/);
  assert.match(state.session.messages.at(-1).content, /haven’t substituted another business/);
  assert.doesNotMatch(state.session.messages.at(-1).content, /L3Harris|closest matching/);
  assert.equal(requests.length, 0);
  assert.ok(webRequests.length >= 2, 'Try grounded name/location variants before stopping');
  assert.equal(state.queue.currentIndex, 0);
  // The unresolved name is held so a one-word spelling fix resumes this ask.
  const saved = await loadSession(session.id);
  assert.equal(saved.pendingLookup.name, 'L3 Installer');
  assert.equal(saved.pendingLookup.location, 'Lugoff, SC');
});

test('a one-word name correction continues the ownership research instead of a nearby search', async () => {
  const session = await createSession();
  session.messages = [];
  await saveSession(session);

  // The rep half-remembers the name. Nothing matches it, but the real business
  // is sitting in the results one letter away.
  webResults = [
    {title: '7 Brew Coffee - Travelers Rest, SC', link: 'https://7brew.example/travelers-rest', snippet: 'Drive-thru coffee in Travelers Rest.'},
    {title: 'Travelers Rest, SC Restaurant Guide', link: 'https://example.com/guide', snippet: 'Places to eat in Travelers Rest.'},
  ];
  const first = await runLiveTurn({
    sessionId: session.id,
    message: 'Find me information about who owns the Seven Bree and Travelers Rest, South Carolina.',
  });
  assert.match(first.session.messages.at(-1).content, /couldn’t verify \*\*Seven Bree\*\*/);
  assert.match(first.session.messages.at(-1).content, /closest public match .*7 Brew Coffee/);
  assert.match(first.session.messages.at(-1).content, /who owns this specific location in Travelers Rest, SC/);
  assert.equal(first.queue, null, 'A named lookup must not open a nearby list');
  assert.equal(requests.length, 0);
  const held = await loadSession(session.id);
  assert.equal(held.pendingLookup.name, 'Seven Bree');
  assert.equal(held.pendingLookup.location, 'Travelers Rest, SC');
  assert.equal(held.pendingLookup.question, 'who owns this specific location');
  assert.equal(held.pendingLookup.suggestion, '7 Brew Coffee');

  webRequests = [];
  webResults = [{
    title: '7 Brew Coffee - Travelers Rest, SC',
    link: 'https://7brew.example/travelers-rest',
    snippet: '7 Brew Coffee in Travelers Rest, SC is a franchise location.',
  }];
  const second = await runLiveTurn({ sessionId: session.id, message: '7brew' });

  assert.equal(second.queue, null, 'A clarification must not launch business discovery');
  assert.ok(webRequests.length >= 1);
  assert.ok(webRequests.every((query) => /Travelers Rest/i.test(query)), `Location must stay attached: ${webRequests.join(' | ')}`);
  assert.ok(webRequests.some((query) => /brew/i.test(query)), `Corrected name must be searched: ${webRequests.join(' | ')}`);
  assert.ok(webRequests.every((query) => !/Greenville/i.test(query)), 'Never fall back to a remembered territory');
  assert.equal(second.activeCompany.name, '7 Brew Coffee', 'Confirming the public spelling adopts it');
  assert.equal(second.activeCompany.location, 'Travelers Rest, SC');
  const reply = second.session.messages.at(-1).content;
  assert.match(reply, /Travelers Rest/);
  assert.match(reply, /Verified/);
  assert.doesNotMatch(reply, /couldn.t verify|no public record/i);
  assert.equal(requests.length, 0, 'Ownership evidence is answered from sources, not a free-form model guess');
  const resolved = await loadSession(session.id);
  assert.equal(resolved.pendingLookup, null, 'A resolved lookup stops being pending');
});

test('named location ownership research keeps first-party evidence and does not stop at the brand', async () => {
  const session = await createSession();
  session.messages = [];
  await saveSession(session);
  const official = {title: 'Travelers Rest, SC', link: 'https://7brew.com/locations/travelers-rest-sc', snippet: 'Drive-thru coffee on N Main Street.'};
  const homepage = {title: '7 Brew Coffee', link: 'https://7brew.com/', snippet: 'Over 1,000 locations nationwide. Corporate does not own individual stores.'};
  const locator = {title: 'Locations | 7 Brew Coffee', link: 'https://7brew.com/locations', snippet: 'Greenville, SC and Spartanburg, SC locations.'};
  const operator = {title: 'Upstate Drive Thru LLC opens 7 Brew in Travelers Rest', link: 'https://upstatetoday.example/7brew-opens', snippet: 'Upstate Drive Thru LLC operates the 7 Brew Coffee location in Travelers Rest, SC.'};
  const other = {title: 'Dutch Bros Coffee - Greenville, SC', link: 'https://dutchbros.example/greenville', snippet: 'Coffee in Greenville.'};
  globalThis.fetch = async (url, init) => {
    if (new URL(url).hostname === 'customsearch.googleapis.com') {
      const query = new URL(url).searchParams.get('q') || '';
      webRequests.push(query);
      const items = /franchisee|operator|operated by|grand opening|owner/i.test(query)
        ? [operator, official]
        : [homepage, locator, official, other];
      return Response.json({items});
    }
    assert.equal(String(url), 'https://model.test/v1/chat/completions', `Unexpected lookup: ${url}`);
    requests.push(JSON.parse(init.body));
    return streamReply('I could not verify a 7 Brew location in Travelers Rest, SC. There is no public record confirming the location.');
  };

  const state = await runLiveTurn({
    sessionId: session.id,
    message: 'Research the 7 Brew Coffee location in Travelers Rest, South Carolina. I want to know who actually owns or operates this specific location — not just who owns the 7 Brew brand.',
  });
  const reply = state.session.messages.at(-1).content;
  assert.equal(state.queue, null, 'Named research must not open a nearby list');
  assert.ok(webRequests.length >= 2, `Weak first search should retry, got ${webRequests.join(' | ')}`);
  assert.ok(webRequests.some((query) => /franchisee|operator/i.test(query)), `Operator follow-up missing: ${webRequests.join(' | ')}`);
  assert.ok(webRequests.every((query) => /Travelers Rest/i.test(query)), `Stay on the requested city: ${webRequests.join(' | ')}`);
  assert.match(reply, /Verified/);
  assert.match(reply, /Travelers Rest/);
  assert.match(reply, /7brew\.com\/locations\/travelers-rest/);
  assert.match(reply, /Upstate Drive Thru LLC/);
  assert.match(reply, /Still not fully verified/);
  assert.match(reply, /exact legal ownership entity/i);
  assert.doesNotMatch(reply, /couldn.t verify|no public record|does not exist/i);
  assert.doesNotMatch(reply, /1,000 locations|corporate does not own/i);
  assert.doesNotMatch(reply, /Dutch Bros/i);
  assert.equal(requests.length, 0, 'Do not let the model deny a sourced location');
  assert.equal(state.activeCompany.name, '7 Brew Coffee');
  assert.equal(state.activeCompany.location, 'Travelers Rest, SC');
});

test('a genuine discovery request after a failed lookup still searches an area', async () => {
  const session = await createSession();
  session.messages = [];
  session.pendingLookup = {
    name: 'Seven Bree',
    location: 'Travelers Rest, SC',
    question: 'who owns this specific location',
    raw: 'who owns the Seven Bree in Travelers Rest',
    suggestion: null,
    askedAt: new Date().toISOString(),
  };
  await saveSession(session);
  // Places and geocoding are offline here; routing is what this test is about.
  const stubbed = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const host = new URL(url).hostname;
    if (host === 'model.test' || host === 'customsearch.googleapis.com') return stubbed(url, init);
    throw new Error('offline in tests');
  };
  await runLiveTurn({ sessionId: session.id, message: 'Find 3 coffee shops in Greenville, SC' });
  const saved = await loadSession(session.id);
  assert.equal(saved.brief.locationHint, 'Greenville, SC', 'Discovery keeps the area the rep just named');
  assert.equal(saved.brief.requestedCount, 3);
  assert.equal(saved.brief.targetName, null, 'A category request is not a named company');
  assert.equal(saved.pendingLookup, null, 'A discovery request supersedes the pending name');
  assert.equal(webRequests.length, 0, 'Discovery must not re-run the named lookup');
});

test('Next question does not advance, while Next one does', async () => {
  const session = await seededChat();
  const first = await runLiveTurn({ sessionId: session.id, message: 'Next question: how do I handle objections?' });
  assert.equal(first.queue.currentIndex, 0);
  const next = await runLiveTurn({ sessionId: session.id, message: 'Next one' });
  assert.equal(next.queue.currentIndex, 1);
  assert.equal(requests.length, 1);
});

test('accepted message and session are available before the model replies', async () => {
  const events = [];
  const state = await runLiveTurn({ message: 'Hello', onEvent: async (event) => {
    events.push(event.type);
    if (event.type === 'session') {
      const saved = await loadSession(event.state.session.id);
      assert.equal(saved.messages.at(-1).content, 'Hello');
      assert.equal(requests.length, 0);
    }
  } });
  assert.equal(events[0], 'session');
  assert.equal(events.at(-1), 'complete');
  assert.equal(state.session.messages.length, 2);
});

test('cancellation stops model work and never persists the partial answer', async () => {
  const controller = new AbortController();
  let id;
  respond = (_body, init) => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(encoder.encode(`data: ${JSON.stringify({choices: [{delta: {content: 'Partial answer'}}]})}\n\n`));
      init.signal.addEventListener('abort', () => stream.error(init.signal.reason), { once: true });
    },
  }));
  await assert.rejects(runLiveTurn({ message: 'Explain a better opener', signal: controller.signal, onEvent: (event) => {
    if (event.type === 'session') id = event.state.session.id;
    if (event.type === 'delta') controller.abort();
  } }), { name: 'AbortError' });
  const saved = await loadSession(id);
  assert.equal(saved.messages.length, 1);
  assert.equal(saved.messages[0].role, 'user');
  assert.equal(requests.length, 1);
});

test('a replacement turn wins over a cancelled reply in the same chat', async () => {
  const session = await seededChat();
  let started;
  const firstStarted = new Promise((resolve) => { started = resolve; });
  respond = (_body, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    started();
  });
  const first = runLiveTurn({ sessionId: session.id, message: 'Explain how to introduce myself' });
  const rejected = assert.rejects(first, { name: 'AbortError' });
  await firstStarted;
  respond = () => streamReply('Sure — let’s change direction.');
  const replacement = await runLiveTurn({ sessionId: session.id, message: 'Actually help me organize my notes' });
  await rejected;
  const saved = await loadSession(session.id);
  assert.equal(saved.messages.at(-1).content, 'Sure — let’s change direction.');
  assert.deepEqual(saved.messages, JSON.parse(JSON.stringify(replacement.session.messages)));
});

test('google and compound asks keep tools on, including google_search', async () => {
  const session = await seededChat();
  await runLiveTurn({ sessionId: session.id, message: 'Google who owns Spectrum and also give me a natural opener' });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].tools.some((tool) => tool.function.name === 'google_search'));
  const prompt = requests[0].messages[0].content;
  assert.match(prompt, /google_search/);
  assert.match(prompt, /every part of what they asked/);
  assert.match(prompt.split('Only actions requested for THIS turn:')[1], /google:/i);
});

test('a named business outside the queue never silently resolves to the current one', async () => {
  const session = await seededChat();
  const state = await runLiveTurn({ sessionId: session.id, message: 'Tell me about A different business' });
  assert.equal(state.queue.currentIndex, 0);
  assert.doesNotMatch(state.session.messages.at(-1).content, /Northline/);
  assert.doesNotMatch(state.session.messages.at(-1).content, /What I verified/);
});

test('a named lookup stays the active company for this-company follow-ups', async () => {
  webResults = [{
    title: 'Oak Street Coffee — Rivertown, SC',
    link: 'https://oakstreetcoffee.example',
    snippet: 'Oak Street Coffee serves Rivertown from a Main Street cafe.',
  }];
  const first = await runLiveTurn({
    message: 'Brief me on Oak Street Coffee in Rivertown, South Carolina.',
  });
  const firstAnswer = first.session.messages.at(-1).content;
  assert.equal(first.queue, null);
  assert.match(firstAnswer, /Oak Street Coffee/);
  assert.match(firstAnswer, /What I verified/);
  assert.doesNotMatch(firstAnswer, /no (?:active|current) (?:company|list)|Find businesses in an area/i);

  responseText = "What's your biggest headache with internet reliability during the lunch rush?";
  const follow = await runLiveTurn({
    sessionId: first.session.id,
    message: 'What does that mean for the call?',
  });
  assert.ok(requests.length >= 1, 'A call-advice follow-up still uses the model');
  assert.match(requests[0].messages[0].content, /Oak Street Coffee/);
  assert.match(requests[0].messages[0].content, /Active company/);
  assert.doesNotMatch(follow.session.messages.at(-1).content, /biggest headache|lunch rush/i);
  assert.match(follow.session.messages.at(-1).content, /day-to-day operation|Oak Street Coffee/i);

  const again = await runLiveTurn({
    sessionId: first.session.id,
    message: 'Brief me on this company again.',
  });
  const answer = again.session.messages.at(-1).content;
  assert.equal(again.queue, null, 'A named lookup must not invent a nearby-business list');
  assert.doesNotMatch(answer, /no (?:active|current) (?:company|list)|Find businesses in an area|Which city/i);
  assert.match(answer, /Oak Street Coffee/);
  assert.match(answer, /What I verified/);
});

test('briefing the current company researches it first and does not treat category copy as fact', async () => {
  const session = await seededChatAt('10 Brief Street, Charlotte, NC');
  const state = await runLiveTurn({ sessionId: session.id, message: 'Brief me on this company' });
  const answer = state.session.messages.at(-1).content;
  assert.equal(requests.length, 0, 'A brief of a listed company must not wait for the model to call research_business');
  assert.ok(webRequests.length > 0, 'Public research has to run before the brief');
  assert.match(answer, /\*\*Northline Logistics\*\*/);
  assert.match(answer, /What I verified/);
  assert.match(answer, /didn’t find a strong company-specific trigger/i);
  assert.doesNotMatch(answer, /connectivity pain|tenant communications|often face/i);
  assert.doesNotMatch(answer, /fit 8[0-9]/);
  assert.ok(state.session.messages.at(-1).thinking?.some((step) => /Reading public sources/i.test(step.label)));
});

test('compound briefing injects company research into the model turn', async () => {
  const session = await seededChatAt('20 Compound Street, Charlotte, NC');
  await runLiveTurn({
    sessionId: session.id,
    message: 'Brief me on this company and also give me a natural opener',
  });
  assert.ok(requests.length >= 1, 'The extra ask still needs the model after research');
  const researched = requests[0].messages.find((message) => message.role === 'tool' && /required_company_research/.test(message.tool_call_id || ''));
  assert.ok(researched, 'Company research must be in the first reasoning request');
  assert.match(researched.content, /verifiedFacts|noStrongTrigger/);
  assert.match(researched.content, /Northline Logistics/);
  assert.doesNotMatch(researched.content, /Lead with how/);
  assert.ok(webRequests.length > 0);
});

test('a leaked industry pitch is replaced with a grounded brief', async () => {
  const session = await seededChatAt('30 Leak Street, Charlotte, NC');
  responseText = 'Property management teams often face connectivity pain points with tenant communications.';
  const state = await runLiveTurn({
    sessionId: session.id,
    message: 'Brief me on this company and also tell me how to open',
  });
  const answer = state.session.messages.at(-1).content;
  assert.match(answer, /didn’t find a strong company-specific trigger/i);
  assert.doesNotMatch(answer, /often face connectivity pain/i);
});

test('a leaked give-up after a soft objection is replaced with another discovery pivot', async () => {
  const session = await seededChatAt('60 Persist Lane, Charlotte, NC');
  responseText = 'Glad to hear it. Thanks for your time. They see no reason to switch.';
  const state = await runLiveTurn({
    sessionId: session.id,
    message: 'They said "We\'re happy with AT&T." What should I say?',
  });
  const answer = state.session.messages.at(-1).content;
  assert.doesNotMatch(answer, /no reason to switch|thanks for your time/i);
  assert.match(answer, /paying|all-in/i);
});

test('in-person next steps are rewritten as remote phone-sales moves', async () => {
  const session = await seededChatAt('50 Remote Row, Charlotte, NC');
  responseText = 'Can I stop by for 5 minutes this week? If not, ask for a site walk.';
  const state = await runLiveTurn({
    sessionId: session.id,
    message: 'What should I do next on the call?',
  });
  const answer = state.session.messages.at(-1).content;
  assert.doesNotMatch(answer, /\b(?:stop by|visit them|site walk|meet in person)\b/i);
  assert.match(answer, /call|callback|discovery|address|phone/i);
});

test('verified public coverage can shape the live opener', async () => {
  const session = await seededChatAt('40 Warehouse Road, Charlotte, NC');
  webResults = [{
    title: 'Northline Logistics opens second warehouse in Charlotte',
    link: 'https://example.com/northline-expansion',
    snippet: 'Northline Logistics opened a second warehouse this spring in Charlotte to handle more freight.',
  }];
  const state = await runLiveTurn({ sessionId: session.id, message: 'What should I know before I call them?' });
  const answer = state.session.messages.at(-1).content;
  assert.equal(requests.length, 0);
  assert.match(answer, /second warehouse/i);
  assert.doesNotMatch(answer, /connectivity pain|often face/i);
});

test('last model round has tools disabled and produces a final answer', async () => {
  const session = await seededChat();
  respond = (body) => {
    if (body.tools) return new Response(`data: ${JSON.stringify({choices: [{delta: {tool_calls: [{index: 0, id: `c${requests.length}`, function: {name: 'unknown_tool', arguments: '{}'}}]}}]})}\n\ndata: [DONE]\n\n`);
    return streamReply('Here is what I can tell you from the listing.');
  };
  const state = await runLiveTurn({ sessionId: session.id, message: 'Help me handle a price objection without sounding desperate' });
  assert.equal(requests.length, 10);
  assert.equal(requests.at(-1).tools, undefined);
  assert.equal(state.session.messages.at(-1).content, 'Here is what I can tell you from the listing.');
});

test('provider failure is explained instead of repeating the current prospect', async () => {
  const session = await seededChat();
  respond = () => new Response(JSON.stringify({ error: {message: 'Model not available'} }), {status: 401});
  const state = await runLiveTurn({ sessionId: session.id, message: 'Why is the sky blue?' });
  assert.match(state.session.messages.at(-1).content, /couldn’t reach the conversation service/);
  assert.doesNotMatch(state.session.messages.at(-1).content, /We are on/);
});

test('/output does not call the model or change the chat', async () => {
  const session = await seededChat();
  const before = await loadSession(session.id);
  const state = await runLiveTurn({ sessionId: session.id, message: '/output' });
  assert.equal(requests.length, 0);
  assert.equal(state.session.messages.length, before.messages.length);
  assert.equal(state.session.messages.at(-1).content, before.messages.at(-1).content);
  const saved = await loadSession(session.id);
  assert.equal(saved.messages.length, before.messages.length);
  assert.equal(saved.title, before.title);
});

test('/livemode does not call the model or change the chat', async () => {
  const session = await seededChat();
  session.activeCompany = {
    name: 'Midlands Notary & Wedding Services',
    location: 'Columbia, SC',
    website: null,
    findings: [],
  };
  await saveSession(session);
  const before = await loadSession(session.id);
  const state = await runLiveTurn({ sessionId: session.id, message: '/livemode' });
  assert.equal(requests.length, 0);
  assert.equal(state.session.messages.length, before.messages.length);
  assert.equal(state.session.messages.at(-1).content, before.messages.at(-1).content);
  assert.equal(state.activeCompany?.name, 'Midlands Notary & Wedding Services');
  const again = await runLiveTurn({ sessionId: session.id, message: '/live mode' });
  assert.equal(requests.length, 0);
  assert.equal(again.session.messages.length, before.messages.length);
  const saved = await loadSession(session.id);
  assert.equal(saved.messages.length, before.messages.length);
  assert.equal(saved.title, before.title);
});

test('Live Coach summary is saved to chat and not to memory', async () => {
  const session = await seededChat();
  const memoryBefore = await loadMemory();
  let view = startCallCoach({
    name: 'Midlands Notary & Wedding Services',
    location: 'Columbia, SC',
    website: null,
    publicTrigger: null,
  });
  view = applyRepUtterance(view.state, 'Oh, you use AT&T?');
  const response = await postCoach(new Request('http://localhost/api/live/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, summary: formatCoachSummary(view.state) }),
  }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.match(payload.state.session.messages.at(-1).content, /Midlands Notary/);
  assert.match(payload.state.session.messages.at(-1).content, /AT&T/);
  assert.doesNotMatch(payload.state.session.messages.at(-1).content, /customer audio|hear the customer|permanent memory/i);
  assert.equal((await loadMemory()).length, memoryBefore.length);
  const saved = await loadSession(session.id);
  assert.equal(saved.messages.at(-1).role, 'assistant');
  assert.doesNotMatch(saved.messages.at(-1).content, /Oh, you use AT&T\?/);
});

test('output API returns a session snapshot for bug logs', async () => {
  const session = await seededChat();
  const response = await getOutput(new Request(`http://localhost/api/live/output?sessionId=${session.id}`));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.snapshot.session.id, session.id);
  assert.equal(payload.snapshot.queue.locationLabel, 'Charlotte, NC');
  assert.ok(payload.snapshot.messages.length >= 1);
});

test('new search reset clears the list and stored brief', async () => {
  const session = await seededChat();
  const state = await runLiveTurn({ sessionId: session.id, message: 'Start over' });
  assert.equal(state.queue, null);
  assert.equal((await loadSession(session.id)).brief, null);
});

test('invalid session paths and oversized messages are rejected before streaming', async () => {
  for (const body of [{ sessionId: '../../memory', message: 'hi' }, { message: 'x'.repeat(2001) }]) {
    const response = await POST(new Request('http://localhost/api/live/chat', { method: 'POST', body: JSON.stringify(body) }));
    assert.equal(response.status, 400);
    assert.equal(requests.length, 0);
  }
  assert.equal(await loadSession('../../memory'), null);
});

test('the HTTP stream sends the session first and cancels provider work on disconnect', async () => {
  let providerAborted = false;
  let began;
  const begun = new Promise(resolve => { began = resolve; });
  respond = (_body, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { providerAborted = true; reject(init.signal.reason); }, {once:true});
    began();
  });
  const response = await POST(new Request('http://localhost/api/live/chat', {method:'POST', body:JSON.stringify({message:'Explain a natural greeting'})}));
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8');
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /"type":"session"/);
  await begun;
  await reader.cancel();
  assert.equal(providerAborted, true);
});

test('normal profile remains complete in context across follow-up turns', async () => {
  const { POST: importProfile } = await import('../src/app/api/live/profile/route.ts');
  const { buildFallbackBrief } = await import('../src/lib/brief-fallback.ts');
  const seeded = await seededChat();
  const prospect = seeded.queue.prospects[0];
  const brief = { ...buildFallbackBrief(prospect, []), summary: 'Profile-only detail: the workshop uses a cloud scheduling system.' };
  const response = await importProfile(new Request('https://app.test/api/live/profile', { method:'POST', body:JSON.stringify({ prospect, brief, intelligence:null, broadband:[] }) }));
  assert.equal(response.status,200);
  const { sessionId } = await response.json();
  responseText = 'The profile says the workshop uses a cloud scheduling system.';
  await runLiveTurn({sessionId,message:'What does the profile say about their operation?'});
  await runLiveTurn({sessionId,message:'How should that affect my opener?'});
  for (const request of requests) {
    const context = request.messages.find(item => item.tool_call_id === 'normal_profile_context');
    assert.ok(context, 'The full imported profile accompanies every turn');
    assert.equal(JSON.parse(context.content).profile.brief.summary, brief.summary);
  }
  const restored = await loadSession(sessionId);
  assert.equal(restored.profileContext.brief.summary,brief.summary);
  assert.equal(webRequests.length,0);
});

test('a failed tool returns evidence feedback so the model can recover', async () => {
  respond = () => requests.length === 1
    ? new Response(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'bad_location',function:{name:'find_businesses',arguments:'{"location":"x"}'}}]}}]})}\n\ndata: [DONE]\n\n`)
    : streamReply('I need a city or ZIP to search that area.');
  const state = await runLiveTurn({message:'Help me plan a prospecting afternoon.'});
  assert.equal(requests.length,2);
  const feedback = requests[1].messages.find(item => item.tool_call_id === 'bad_location');
  assert.equal(JSON.parse(feedback.content).ok,false);
  assert.match(JSON.parse(feedback.content).nextStep,/another relevant tool/);
  assert.equal(state.session.messages.at(-1).content,'I need a city or ZIP to search that area.');
});
