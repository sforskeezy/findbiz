import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runLiveTurn, shouldRejectUngroundedDiscovery } from '../src/lib/live/engine.ts';
import { createSession, saveSession, loadSession } from '../src/lib/live/store.ts';
import { parseLiveBrief } from '../src/lib/live/intent.ts';
import { generateDemoResearch } from '../src/lib/demo-data.ts';
import { POST } from '../src/app/api/live/chat/route.ts';

let root;
const realFetch = globalThis.fetch;
let requests;
let responseText;
let respond;
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
});

after(async () => { globalThis.fetch = realFetch; await rm(root, { recursive: true, force: true }); });
beforeEach(() => {
  requests = [];
  responseText = 'Start with a short introduction and one useful question.';
  respond = () => streamReply(responseText);
  globalThis.fetch = async (url, init) => {
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
  responseText = 'I found **Macon Lawn** in Lugoff from public listings.';
  const state = await runLiveTurn({
    message: 'google and find a company im looking for in lugoff sc named macons lawn and lanscape company',
  });
  assert.match(state.session.messages.at(-1).content, /Macon Lawn/);
  assert.doesNotMatch(state.session.messages.at(-1).content, /couldn’t verify matching listings/);
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

test('last model round has tools disabled and produces a final answer', async () => {
  const session = await seededChat();
  respond = (body) => {
    if (body.tools) return new Response(`data: ${JSON.stringify({choices: [{delta: {tool_calls: [{index: 0, id: `c${requests.length}`, function: {name: 'unknown_tool', arguments: '{}'}}]}}]})}\n\ndata: [DONE]\n\n`);
    return streamReply('Here is what I can tell you from the listing.');
  };
  const state = await runLiveTurn({ sessionId: session.id, message: 'Tell me about the first business' });
  assert.equal(requests.length, 6);
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

test('a named business outside the queue never silently resolves to the current one', async () => {
  const session = await seededChat();
  respond = (body) => {
    if (requests.length === 1) return new Response(`data: ${JSON.stringify({choices: [{delta: {tool_calls: [{index: 0, id: 'named_lookup', function: {name: 'research_business', arguments: JSON.stringify({name: 'A different business'})}}]}}]})}\n\ndata: [DONE]\n\n`);
    assert.equal(JSON.parse(body.messages.at(-1).content).ok, false);
    return streamReply('Which city is that business in?');
  };
  const state = await runLiveTurn({ sessionId: session.id, message: 'Tell me about A different business' });
  assert.equal(state.queue.currentIndex, 0);
  assert.equal(state.session.messages.at(-1).content, 'Which city is that business in?');
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
