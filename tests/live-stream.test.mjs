import test from 'node:test';
import assert from 'node:assert/strict';
import { readEventStream } from '../src/lib/live/stream.ts';
const encoder = new TextEncoder();

test('SSE survives split UTF-8, CRLF, comments and a final frame without a newline', async () => {
  const bytes = encoder.encode(': keepalive\r\n\r\ndata: {"text":"café"}\r\n\r\ndata:{"text":"done"}');
  const stream = new ReadableStream({start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  }});
  const events = [];
  await readEventStream(new Response(stream), (event) => events.push(event));
  assert.deepEqual(events, [{ text: 'café' }, { text: 'done' }]);
});

test('consumer failure cancels the underlying response', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('data: {"type":"error"}\n\n'));
  }, cancel() { cancelled = true; } }));
  await assert.rejects(readEventStream(response, () => { throw new Error('Stop'); }), /Stop/);
  assert.equal(cancelled, true);
});
