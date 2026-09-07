import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/app/api/live/transcribe/route.ts';

const realFetch = globalThis.fetch;
let previousKey;
beforeEach(() => {
  previousKey = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = 'test-only';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = previousKey;
});

function recording(signal) {
  return new Request('http://localhost/api/live/transcribe', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: 'data:audio/webm;base64,YXVkaW8=' }),
  });
}
const transcript = (text) => Response.json({ choices: [{ message: { content: text } }] });

for (const reply of ['okay', 'thanks', 'thank you', 'bye', 'mhm', 'uh huh']) {
  test(`voice keeps the conversational reply "${reply}"`, async () => {
    globalThis.fetch = async () => transcript(reply);
    const response = await POST(recording());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).transcript.toLowerCase(), reply);
  });
}

test('voice still rejects filler-only recordings', async () => {
  globalThis.fetch = async () => transcript('um');
  assert.equal((await POST(recording())).status, 422);
});

test('canceling transcription aborts provider work', async () => {
  const controller = new AbortController();
  let providerSignal;
  let notifyStarted;
  const started = new Promise((resolve) => { notifyStarted = resolve; });
  globalThis.fetch = async (_, init) => {
    providerSignal = init.signal;
    notifyStarted();
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  };
  const pending = POST(recording(controller.signal));
  await started;
  controller.abort();
  assert.equal((await pending).status, 499);
  assert.equal(providerSignal.aborted, true);
});

test('a canceled recording never starts transcription', async () => {
  globalThis.fetch = async () => assert.fail('Unexpected provider request');
  const controller = new AbortController();
  controller.abort();
  assert.equal((await POST(recording(controller.signal))).status, 499);
});
