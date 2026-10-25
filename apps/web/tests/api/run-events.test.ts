import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET } from '../../app/api/runs/events/route.ts';

const token = 'b'.repeat(64);
const request = () => new Request('http://localhost/api/runs/events', {
  headers: { Authorization: `Bearer ${token}` },
});

test('SSE bridge requires a header credential and rejects query credentials', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  assert.equal((await GET(new Request('http://localhost/api/runs/events'))).status, 404);
  assert.equal((await GET(new Request(`http://localhost/api/runs/events?token=${token}`, {
    headers: { Authorization: `Bearer ${token}` },
  }))).status, 404);
  assert.equal(mock.mock.callCount(), 0);
});

test('SSE bridge streams without eager reads and cancels its upstream reader', async (t) => {
  let reads = 0;
  let cancelled = false;
  let signal: AbortSignal | undefined;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new TextEncoder().encode(': heartbeat\n\n')); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    assert.equal(url.pathname, '/runs/events');
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${token}`);
    signal = options.signal ?? undefined;
    return new Response(source, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.equal(reads, 0);
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /heartbeat/);
  assert.equal(reads, 1);
  await reader.cancel();
  assert.equal(cancelled, true);
  assert.equal(signal?.aborted, true);
});

test('SSE bridge rejects oversized upstream chunks and hides upstream error bodies', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(300_000), {
    headers: { 'Content-Type': 'text/event-stream' },
  }));
  await assert.rejects((await GET(request())).body!.getReader().read(), /disconnected/);
  t.mock.method(globalThis, 'fetch', async () => new Response('private upstream details', { status: 404 }));
  const missing = await GET(request());
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'RUN_STREAM_UNAVAILABLE' });
  t.mock.method(globalThis, 'fetch', async () => new Response('wrong content type'));
  assert.equal((await GET(request())).status, 503);
});
