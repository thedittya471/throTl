import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { createSharedWindowStore, sharedWindowKey, readRedisUrl } from '../../src/redis.ts';
import { startRedis } from '../helpers/redis.ts';

const config = { limit: 10, windowMs: 60_000, durationMs: 100, ratePerSecond: 1 };

test('Redis URL validation rejects malformed configuration without exposing credentials', () => {
  assert.equal(readRedisUrl({}), undefined);
  assert.equal(readRedisUrl({ REDIS_URL: 'redis://127.0.0.1:6379' }), 'redis://127.0.0.1:6379');
  for (const url of ['', 'http://localhost', 'private password', 'redis://localhost#fragment']) {
    assert.throws(() => readRedisUrl({ REDIS_URL: url }), { message: 'REDIS_URL must be a Redis connection URL' });
  }
});

test('atomic shared decisions prevent the demonstrated read-then-write race and preserve isolated expiring state', async (t) => {
  const { url, admin } = await startRedis(t);
  const stores = Array.from({ length: 3 }, () => createSharedWindowStore(url));
  t.after(() => stores.forEach((store) => store.close()));
  const limiters = await Promise.all(stores.map((store) => store.register('experiment-one', config)));
  const remaining = 60_000 - Date.now() % 60_000;
  if (remaining < 2_000) await delay(remaining + 20);
  // A barrier makes every unsafe reader see zero before any writer increments.
  const staleCounts = await Promise.all(Array.from({ length: 60 }, () => admin.get('unsafe-example')));
  const unsafeAdmissions = staleCounts.filter((count) => Number(count) < config.limit);
  await Promise.all(unsafeAdmissions.map(() => admin.incr('unsafe-example')));
  assert.equal(Number(await admin.get('unsafe-example')), 60);
  const decisions = await Promise.all(Array.from({ length: 60 }, (_, index) => limiters[index % 3]!.check()));
  assert.equal(decisions.filter((decision) => decision.allowed).length, 10);
  assert.equal(decisions.filter((decision) => !decision.allowed).length, 50);
  assert.deepEqual(decisions.filter((decision) => decision.allowed).map((decision) => decision.state.countAfter).sort((a, b) => a - b), [1,2,3,4,5,6,7,8,9,10]);
  const key = sharedWindowKey('experiment-one');
  assert.match(key, /^ratelab:\{[a-f0-9]{64}\}:fixed-window:global$/);
  const ttl = await admin.pTTL(key);
  assert.ok(ttl > 29_000 && ttl <= config.durationMs + 30_000);
  const isolated = await stores[0]!.register('experiment-two', config);
  assert.equal((await isolated.check()).state.countBefore, 0);
  // Accelerate the real Redis expiry after verifying the script's full TTL.
  await admin.pExpire(key, 30); await delay(60);
  assert.equal(await admin.exists(key), 0);
  assert.equal((await limiters[0]!.check()).state.countBefore, 0);
  await stores[0]!.remove('experiment-one');
  assert.equal(await admin.exists(key), 0);
  assert.equal(await admin.exists(sharedWindowKey('experiment-two')), 1);
  await stores[0]!.remove('experiment-two');
});

test('a disconnected Redis store rejects checks without falling back to local allowance', async (t) => {
  const { url, stop } = await startRedis(t);
  const store = createSharedWindowStore(url); t.after(() => store.close());
  const limiter = await store.register('outage', config);
  assert.equal((await limiter.check()).allowed, true);
  await stop();
  await assert.rejects(limiter.check(), { message: 'REDIS_UNAVAILABLE' });
});

test('old runs cannot resume after a Redis connection is replaced for a new run', async (t) => {
  const { url, admin } = await startRedis(t);
  const store = createSharedWindowStore(url); t.after(() => store.close());
  const old = await store.register('before-disconnect', config);
  await old.check();
  await admin.sendCommand(['CLIENT', 'KILL', 'TYPE', 'normal', 'SKIPME', 'yes']);
  await delay(30);
  const fresh = await store.register('after-disconnect', config);
  assert.equal((await fresh.check()).allowed, true);
  await assert.rejects(old.check(), { message: 'REDIS_UNAVAILABLE' });
  assert.equal((await fresh.check()).state.countAfter, 2);
});

test('shared windows reset stale counters and clamp a backwards Redis clock observation', async (t) => {
  const { url, admin } = await startRedis(t);
  const store = createSharedWindowStore(url); t.after(() => store.close());
  const limiter = await store.register('clock-evidence', config);
  const key = sharedWindowKey('clock-evidence');
  await admin.hSet(key, { start: '0', count: '10', time: '0' });
  const reset = await limiter.check();
  assert.equal(reset.allowed, true);
  assert.equal(reset.state.countBefore, 0);
  assert.equal(reset.state.windowStartMs, reset.state.rawTimeMs - reset.state.rawTimeMs % config.windowMs);
  const future = Date.now() + 10_000;
  await admin.hSet(key, { start: String(future - future % config.windowMs), count: '10', time: String(future) });
  const clamped = await limiter.check();
  assert.equal(clamped.allowed, false);
  assert.equal(clamped.state.clockClamped, true);
  assert.equal(clamped.state.effectiveTimeMs, future);
  assert.equal(clamped.state.countAfter, 10);
  assert.equal(clamped.retryAfterMs, clamped.resetAtMs - clamped.state.rawTimeMs);
});
