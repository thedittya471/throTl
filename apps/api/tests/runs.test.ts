import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test, type TestContext } from 'node:test';
import { parseRunSnapshot } from '@ratelab/contracts';
import { createApp } from '../src/server.ts';

async function setup(t: TestContext) {
  const app = createApp({ now: () => 100 });
  const server = createServer(app);
  t.after(async () => {
    await app.locals.stopRuns();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/runs`;
  const headers = { 'X-RateLab-Request': '1', 'Content-Type': 'application/json' };
  const config = { durationMs: 300, ratePerSecond: 20, limit: 1, windowMs: 60_000 };
  const start = () => fetch(url, { method: 'POST', headers, body: JSON.stringify(config) });
  return { url, headers, config, start, shutdown: app.locals.stopRuns as () => Promise<void> };
}

function reconcile(counts: ReturnType<typeof parseRunSnapshot>['counts']) {
  assert.equal(counts.scheduled, counts.dispatched + counts.missed);
  assert.equal(counts.dispatched, counts.responseReceived + counts.transportFailed + counts.cancelled + counts.timedOut);
  assert.equal(counts.dispatched, counts.allowed + counts.rejected + counts.unknownDecision);
  assert.equal(counts.inFlight, 0);
  assert.equal(counts.missed, counts.missedLate + counts.missedInFlight + counts.missedCancelled);
}

test('a real steady run completes with isolated allowance and reconciled HTTP counts', async (t) => {
  const { url, headers, start } = await setup(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await start();
    assert.equal(response.status, 201);
    const started = await response.json();
    assert.match(started.token, /^[a-f0-9]{64}$/);
    const auth = { ...headers, Authorization: `Bearer ${started.token}` };
    let run = parseRunSnapshot(started.run);
    const deadline = Date.now() + 5_000;
    while (run.status !== 'completed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      run = parseRunSnapshot(await (await fetch(url, { headers: auth })).json());
    }
    assert.equal(run.status, 'completed');
    assert.ok(run.telemetry);
    assert.equal(run.telemetry.allowed, run.counts.allowed);
    assert.equal(run.telemetry.rejected, run.counts.rejected);
    assert.equal(run.telemetry.evaluated, run.counts.responseReceived);
    assert.equal(run.telemetry.recent.at(-1)!.decision.state.limit, 1);
    assert.equal(run.counts.allowed, 1);
    assert.ok(run.counts.rejected > 0);
    reconcile(run.counts);
  }
});

test('stop waits for teardown, is idempotent, and prevents later dispatch', async (t) => {
  const { url, headers } = await setup(t);
  const response = await fetch(url, { method: 'POST', headers,
    body: JSON.stringify({ durationMs: 10_000, ratePerSecond: 50, limit: 2, windowMs: 1_000 }) });
  const started = await response.json();
  const auth = { ...headers, Authorization: `Bearer ${started.token}` };
  await new Promise((resolve) => setTimeout(resolve, 75));
  const stopped = parseRunSnapshot(await (await fetch(url, { method: 'DELETE', headers: auth })).json());
  assert.equal(stopped.status, 'stopped');
  assert.ok(stopped.counts.missedCancelled > 0);
  reconcile(stopped.counts);
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.deepEqual(await (await fetch(url, { headers: auth })).json(), stopped);
  assert.deepEqual(await (await fetch(url, { method: 'DELETE', headers: auth })).json(), stopped);
});

test('control and target endpoints reject invalid credentials and arbitrary configuration', async (t) => {
  const { url, headers, config } = await setup(t);
  assert.equal((await fetch(url, { headers })).status, 404);
  assert.equal((await fetch(url, { method: 'DELETE', headers })).status, 404);
  assert.equal((await fetch(`${url.replace('/runs', '/internal/runs')}/target`)).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 403);
  for (const input of [{ ...config, target: 'http://example.com' }, { ...config, limit: 0 }, {}]) {
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) })).status, 400);
  }
  assert.equal((await fetch(url, { method: 'POST', headers, body: '{broken' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers, body: ' '.repeat(2_000) })).status, 413);
  assert.equal((await fetch(`${url}?target=http://example.com`, { method: 'POST', headers,
    body: JSON.stringify(config) })).status, 400);
  const started = await (await fetch(url, { method: 'POST', headers, body: JSON.stringify(config) })).json();
  assert.equal((await fetch(`${url.replace('/runs', '/internal/runs')}/target`, { headers: { Authorization: `Bearer ${started.token}` } })).status, 404);
});

test('run admission is bounded and shutdown settles every active run', async (t) => {
  const { url, headers, shutdown } = await setup(t);
  const tokens: string[] = [];
  for (let index = 0; index < 10; index++) {
    const response = await fetch(url, { method: 'POST', headers,
      body: JSON.stringify({ durationMs: 120_000, ratePerSecond: 1, limit: 1, windowMs: 1_000 }) });
    assert.equal(response.status, 201);
    tokens.push((await response.json()).token);
  }
  const response = await fetch(url, { method: 'POST', headers,
    body: JSON.stringify({ durationMs: 120_000, ratePerSecond: 1, limit: 1, windowMs: 1_000 }) });
  assert.equal(response.status, 503);
  await shutdown();
  for (const token of tokens) {
    const run = parseRunSnapshot(await (await fetch(url, {
      headers: { ...headers, Authorization: `Bearer ${token}` },
    })).json());
    assert.equal(run.status, 'stopped');
    reconcile(run.counts);
  }
});

test('authenticated SSE reconnects with current totals and delivers the final reconciled snapshot', async (t) => {
  const { url, headers, start } = await setup(t);
  assert.equal((await fetch(`${url}/events`, { headers })).status, 404);
  const started = await (await start()).json();
  const auth = { ...headers, Authorization: `Bearer ${started.token}` };
  const first = await fetch(`${url}/events`, { headers: auth });
  assert.match(first.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = first.body!.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);
  const initialRun = parseRunSnapshot(JSON.parse(initial.split('data: ')[1]!));
  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = await fetch(`${url}/events`, { headers: auth });
  const frames = (await second.text()).split('\n\n').filter((frame) => frame.startsWith('event: snapshot'));
  const snapshots = frames.map((frame) => parseRunSnapshot(JSON.parse(frame.split('data: ')[1]!)));
  assert.ok(snapshots[0]!.counts.dispatched >= initialRun.counts.dispatched);
  const final = snapshots.at(-1)!;
  assert.equal(final.status, 'completed');
  reconcile(final.counts);
  assert.deepEqual(await (await fetch(url, { headers: auth })).json(), final);
});

test('shared mode without configured Redis fails explicitly while local mode stays available', async (t) => {
  const { url, headers, config, start } = await setup(t);
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...config, stateMode: 'shared' }) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'REDIS_UNAVAILABLE' });
  assert.equal((await start()).status, 201);
});
