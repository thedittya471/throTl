import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { parseRunSnapshot } from '@ratelab/contracts';
import { sharedWindowKey } from '../src/redis.ts';
import { startRedis } from './helpers/redis.ts';

const config = { durationMs: 1_000, ratePerSecond: 60, limit: 10, windowMs: 60_000, stateMode: 'shared' } as const;

test('three real API processes share exactly L admissions and report a Redis outage as a failed run', { timeout: 25_000 }, async (t) => {
  const redis = await startRedis(t);
  const reservations = Array.from({ length: 3 }, () => createServer());
  const ports: number[] = [];
  for (const reservation of reservations) {
    reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const address = reservation.address(); assert.ok(address && typeof address !== 'string'); ports.push(address.port);
  }
  await Promise.all(reservations.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  const origins = ports.map((port) => `http://127.0.0.1:${port}`);
  const secret = randomBytes(32).toString('hex');
  const children: ReturnType<typeof spawn>[] = [];
  t.after(async () => {
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 5_000);
      try { await exited; } finally { clearTimeout(deadline); }
    }));
  });
  for (let index = 2; index >= 0; index--) {
    const child = spawn(process.execPath, [new URL('../src/index.ts', import.meta.url).pathname], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(ports[index]), INSTANCE_ID: `api-${index + 1}`,
        INSTANCE_SECRET: secret, INSTANCE_PEERS: index === 0 ? origins.slice(1).join(',') : '', REDIS_URL: redis.url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('API startup timed out')), 5_000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(deadline); reject(new Error('API exited before listening')); });
      child.stdout!.on('data', (chunk) => { if (String(chunk).includes('listening')) { clearTimeout(deadline); resolve(); } });
    });
  }
  const internalHeaders = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  const targetToken = `Bearer ${randomBytes(32).toString('hex')}`;
  const registration = await Promise.all(origins.map((origin) => fetch(`${origin}/internal/runs`, {
    method: 'POST', headers: internalHeaders, body: JSON.stringify({ token: targetToken, config }),
  })));
  assert.ok(registration.every((response) => response.status === 201));
  await Promise.all(registration.map((response) => response.body?.cancel()));
  const remaining = 60_000 - Date.now() % 60_000;
  if (remaining < 5_000) await delay(remaining + 30);
  const responses = await Promise.all(Array.from({ length: 90 }, (_, index) => fetch(`${origins[index % 3]}/internal/runs/target`, {
    headers: { Authorization: targetToken },
  })));
  assert.equal(responses.filter((response) => response.status === 200).length, 10);
  assert.equal(responses.filter((response) => response.status === 429).length, 80);
  const evidence = await Promise.all(responses.map((response) => response.json()));
  assert.equal(new Set(evidence.map((item) => item.instance)).size, 3);
  assert.ok(evidence.every((item) => item.decision.state.countAfter <= config.limit));
  for (const origin of origins) {
    const removed = await fetch(`${origin}/internal/runs`, { method: 'DELETE', headers: internalHeaders, body: JSON.stringify({ token: targetToken }) });
    assert.equal(removed.status, 204);
  }
  // Internal target removal cannot reset another process's shared allowance.
  assert.equal(await redis.admin.exists(sharedWindowKey(targetToken)), 1);
  await redis.admin.del(sharedWindowKey(targetToken));

  const url = `${origins[0]}/runs`;
  const headers = { 'X-RateLab-Request': '1', 'Content-Type': 'application/json' };
  async function start(durationMs: number = config.durationMs) {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...config, durationMs }) });
    assert.equal(response.status, 201); return response.json();
  }
  async function finish(token: string) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const response = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${token}` } });
      const run = parseRunSnapshot(await response.json());
      if (['completed', 'failed', 'stopped'].includes(run.status)) return run;
      await delay(15);
    }
    throw new Error('Run did not finish');
  }
  const completed = await finish((await start()).token);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.counts.allowed, 10);
  assert.ok(completed.counts.rejected > 0);
  assert.equal(completed.counts.unknownDecision, 0);
  assert.equal(completed.instances!.reduce((sum, instance) => sum + instance.counts.allowed, 0), 10);
  assert.deepEqual(await redis.admin.keys('ratelab:*'), []);

  const stoppedStart = await start(10_000);
  const stopped = parseRunSnapshot(await (await fetch(url, { method: 'DELETE',
    headers: { ...headers, Authorization: `Bearer ${stoppedStart.token}` } })).json());
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(await redis.admin.keys('ratelab:*'), []);

  const started = await start(10_000);
  const auth = { ...headers, Authorization: `Bearer ${started.token}` };
  const stream = await fetch(`${url}/events`, { headers: auth });
  await delay(80); await redis.stop();
  const final = await finish(started.token);
  assert.equal(final.status, 'failed');
  assert.equal(final.error, 'REDIS_UNAVAILABLE');
  assert.ok(final.counts.unknownDecision > 0);
  assert.ok(final.counts.missedCancelled > 0);
  assert.equal(final.counts.inFlight, 0);
  assert.equal(final.counts.scheduled, final.counts.dispatched + final.counts.missed);
  assert.equal(final.counts.dispatched, final.counts.allowed + final.counts.rejected + final.counts.unknownDecision);
  const frames = (await stream.text()).split('\n\n').filter((frame) => frame.startsWith('event: snapshot'));
  const last = parseRunSnapshot(JSON.parse(frames.at(-1)!.split('data: ')[1]!));
  assert.equal(last.status, 'failed'); assert.equal(last.error, 'REDIS_UNAVAILABLE');
  await delay(50);
  assert.deepEqual(parseRunSnapshot(await (await fetch(url, { headers: auth })).json()), final);
  const unavailable = await fetch(url, { method: 'POST', headers, body: JSON.stringify(config) });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: 'REDIS_UNAVAILABLE' });
});
