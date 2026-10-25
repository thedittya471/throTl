import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test, type TestContext } from 'node:test';
import { createApp } from '../src/server.ts';

async function startDemo(t: TestContext, options = {}) {
  const server = createServer(createApp(options));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/demo`;
}

test('demo returns matching decisions and headers through exhaustion and recovery', async (t) => {
  let time = 100;
  const url = await startDemo(t, { limit: 2, windowMs: 2_000, now: () => time });
  for (const [allowed, remaining] of [[true, 1], [true, 0], [false, 0]] as const) {
    const response = await fetch(url);
    assert.equal(response.status, allowed ? 200 : 429);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-ratelab-algorithm'), 'fixed-window');
    assert.equal(response.headers.get('x-ratelab-instance'), 'local');
    assert.equal(response.headers.get('x-ratelab-decision'), allowed ? 'allowed' : 'rejected');
    assert.equal(response.headers.get('x-ratelab-limit'), '2');
    assert.equal(response.headers.get('x-ratelab-remaining'), String(remaining));
    assert.equal(response.headers.get('x-ratelab-reset-ms'), '2000');
    assert.equal(response.headers.get('retry-after'), allowed ? null : '2');
    const body = await response.json();
    assert.equal(body.version, 1);
    assert.equal(body.algorithm, 'fixed-window');
    assert.equal(body.instance, 'local');
    assert.equal(body.decision.allowed, allowed);
    assert.equal(body.decision.remaining, remaining);
    assert.equal(body.decision.resetAtMs, 2_000);
    assert.equal(body.decision.retryAfterMs, allowed ? 0 : 1_900);
    assert.equal(body.decision.state.countAfter, 2 - remaining);
  }
  time = 2_000;
  const recovered = await fetch(url);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.headers.get('x-ratelab-remaining'), '1');
  assert.equal(recovered.headers.get('x-ratelab-reset-ms'), '4000');
  assert.equal(recovered.headers.get('retry-after'), null);
});

test('demo rejects query configuration and unsupported methods before consuming allowance', async (t) => {
  const url = await startDemo(t, { limit: 1, windowMs: 1_000, now: () => 0 });
  for (const query of ['clientId=alice', 'limit=1000', 'target=http://example.com', 'key[]=a', 'unknown=1']) {
    const response = await fetch(`${url}?${query}`);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-ratelab-decision'), null);
    assert.deepEqual(await response.json(), { error: 'DEMO_QUERY_NOT_SUPPORTED' });
  }
  for (const method of ['POST', 'HEAD']) {
    const response = await fetch(url, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET');
  }
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url, { headers: { 'X-Forwarded-For': '192.0.2.1' } })).status, 429);
});

test('concurrent HTTP requests cannot exceed the fixed-window allowance', async (t) => {
  const url = await startDemo(t, { limit: 5, windowMs: 1_000, now: () => 0 });
  const responses = await Promise.all(Array.from({ length: 20 }, () => fetch(url)));
  assert.equal(responses.filter((response) => response.status === 200).length, 5);
  assert.equal(responses.filter((response) => response.status === 429).length, 15);
  await Promise.all(responses.map((response) => response.arrayBuffer()));
});

test('retry headers round up, include clock rollback, and never return zero', async (t) => {
  let time = 1_100;
  const url = await startDemo(t, { limit: 1, windowMs: 1_000, now: () => time });
  assert.equal((await fetch(url)).status, 200);
  time = 900;
  const rollback = await fetch(url);
  assert.equal(rollback.status, 429);
  assert.equal(rollback.headers.get('retry-after'), '2');
  const body = await rollback.json();
  assert.equal(body.decision.retryAfterMs, 1_100);
  assert.equal(body.decision.state.clockClamped, true);
  time = 1_999;
  const nearReset = await fetch(url);
  assert.equal(nearReset.status, 429);
  assert.equal(nearReset.headers.get('retry-after'), '1');
});

test('demo defaults to 100 per minute and app instances keep separate state', async (t) => {
  const first = await startDemo(t);
  const second = await startDemo(t);
  for (const url of [first, second]) {
    const response = await fetch(url);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-ratelab-limit'), '100');
    assert.equal(body.decision.state.countBefore, 0);
    assert.equal(body.decision.resetAtMs - body.decision.state.windowStartMs, 60_000);
  }
});

test('invalid server-owned demo configuration fails before listening', () => {
  assert.throws(() => createApp({ limit: 0 }), /limit must be a positive safe integer/);
  assert.throws(() => createApp({ windowMs: -1 }), /windowMs must be a positive safe integer/);
});
