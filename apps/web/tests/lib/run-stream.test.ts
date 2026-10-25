import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RUN_CONFIG } from '@ratelab/contracts';
import { readRunStream, watchRun } from '../../lib/run-stream.ts';

const run = { version: 1, id: 'a'.repeat(32), status: 'completed', config: DEFAULT_RUN_CONFIG,
  counts: { scheduled: 2, dispatched: 2, responseReceived: 2, allowed: 1, rejected: 1,
    unknownDecision: 0, transportFailed: 0, cancelled: 0, timedOut: 0, inFlight: 0,
    missed: 0, missedLate: 0, missedInFlight: 0, missedCancelled: 0 } };
function stream(...chunks: string[]) {
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } });
}

test('SSE parser handles split frames, heartbeats and replacement snapshots', async () => {
  const totals: number[] = [];
  const running = { ...run, status: 'running', counts: { ...run.counts, allowed: 0 } };
  const frames = `: heartbeat\r\n\r\nevent: snapshot\r\ndata: ${JSON.stringify(running)}\r\n\r\nevent: snapshot\r\ndata: ${JSON.stringify(run)}\r\n\r\n`;
  await readRunStream(stream(frames.slice(0, 15), frames.slice(15, 100), frames.slice(100)), (snapshot) => totals.push(snapshot.counts.allowed));
  assert.deepEqual(totals, [0, 1]);
});

test('SSE parser rejects oversized, malformed, incompatible, and incomplete events', async () => {
  for (const body of [stream('x'.repeat(70_000)), stream('event: snapshot\ndata: {broken}\n\n'),
    stream(`event: snapshot\ndata: ${JSON.stringify({ ...run, version: 2 })}\n\n`), stream(': heartbeat\n\n')]) {
    await assert.rejects(readRunStream(body, () => {}));
  }
});

test('watcher sends credentials in headers and reconnects with replacement totals', async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${'b'.repeat(64)}`);
    attempts++;
    return new Response(attempts === 1 ? stream(': heartbeat\n\n')
      : stream(`event: snapshot\ndata: ${JSON.stringify(run)}\n\n`));
  });
  let allowed = 0;
  await watchRun('b'.repeat(64), new AbortController().signal, (snapshot) => { allowed = snapshot.counts.allowed; }, () => {});
  assert.equal(attempts, 2);
  assert.equal(allowed, 1);
});

test('SSE parser delivers Redis failure as a terminal snapshot', async () => {
  let received = '';
  const failed = { ...run, status: 'failed', error: 'REDIS_UNAVAILABLE', config: { ...run.config, stateMode: 'shared' } };
  await readRunStream(stream(`event: snapshot\ndata: ${JSON.stringify(failed)}\n\n`), (snapshot) => { received = snapshot.error ?? ''; });
  assert.equal(received, 'REDIS_UNAVAILABLE');
});
