import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { parseRunSnapshot } from '@ratelab/contracts';
import { readInstances } from '../src/instances.ts';

test('instance configuration rejects unsafe or ambiguous registrations', () => {
  assert.deepEqual(readInstances({}), { instanceId: 'local', peers: [] });
  for (const env of [
    { INSTANCE_ID: 'bad id' }, { INSTANCE_PEERS: 'http://localhost:1' },
    { INSTANCE_PEERS: 'https://localhost:1,http://localhost:2' },
    { INSTANCE_PEERS: 'http://user:password@localhost:1,http://localhost:2' },
    { INSTANCE_PEERS: 'http://localhost:1/path,http://localhost:2' },
    { INSTANCE_PEERS: 'http://localhost:1,http://localhost:1' },
    { INSTANCE_PEERS: 'http://localhost:1,http://localhost:2', INSTANCE_SECRET: 'short' },
  ]) assert.throws(() => readInstances(env));
});

test('three real API processes admit 3L locally, isolate runs, and expose a killed target as transport failure', { timeout: 25_000 }, async (t) => {
  const ports: number[] = [];
  for (let index = 0; index < 3; index++) {
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
    const address = reservation.address(); assert.ok(address && typeof address !== 'string');
    ports.push(address.port);
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
  }
  const origins = ports.map((port) => `http://127.0.0.1:${port}`);
  const secret = 'a'.repeat(64);
  const children: ReturnType<typeof spawn>[] = [];
  t.after(async () => {
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 5_000);
      try { await exited; } finally { clearTimeout(deadline); }
    }));
  });
  for (let index = 2; index >= 0; index--) {
    const child = spawn(process.execPath, [new URL('../src/index.ts', import.meta.url).pathname], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(ports[index]), INSTANCE_ID: `api-${index + 1}`,
        INSTANCE_SECRET: secret, INSTANCE_PEERS: index === 0 ? origins.slice(1).join(',') : '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children[index] = child;
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('API startup timed out')), 5_000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(deadline); reject(new Error('API exited before listening')); });
      child.stdout!.on('data', (chunk) => {
        if (String(chunk).includes('listening')) { clearTimeout(deadline); resolve(); }
      });
    });
  }
  const identities = await Promise.all(origins.map(async (origin) => (await fetch(`${origin}/instance`)).json()));
  assert.deepEqual(identities.map((value) => value.instanceId), ['api-1', 'api-2', 'api-3']);
  assert.equal((await fetch(`${origins[1]}/internal/runs`, { method: 'POST' })).status, 404);
  const headers = { 'X-RateLab-Request': '1', 'Content-Type': 'application/json' };
  const url = `${origins[0]}/runs`;
  const config = { durationMs: 1_000, ratePerSecond: 60, limit: 10, windowMs: 60_000 };
  // Keep the real HTTP proof inside a single epoch-aligned window.
  const remaining = 60_000 - Date.now() % 60_000;
  if (remaining < 5_000) await delay(remaining + 50);
  async function start() {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(config) });
    assert.equal(response.status, 201);
    return response.json();
  }
  async function finish(token: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${token}` } });
      const run = parseRunSnapshot(await response.json());
      if (run.status === 'completed') return run;
      await delay(15);
    }
    throw new Error('Run did not finish');
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const run = await finish((await start()).token);
    assert.equal(run.counts.allowed, 30);
    assert.ok(run.counts.rejected > 0);
    assert.equal(run.counts.transportFailed, 0);
    assert.deepEqual(run.instances!.map((item) => item.counts.allowed), [10, 10, 10]);
    const dispatches = run.instances!.map((item) => item.counts.dispatched);
    assert.ok(Math.max(...dispatches) - Math.min(...dispatches) <= 1);
    assert.equal(run.telemetry!.evaluated, run.counts.allowed + run.counts.rejected);
    assert.equal(new Set(run.telemetry!.recent.map((item) => item.instance)).size, 3);
  }
  const started = await start();
  const killed = children[2]!;
  const exited = once(killed, 'exit'); killed.kill('SIGKILL'); await exited;
  const failed = await finish(started.token);
  const dead = failed.instances!.find((item) => item.id === 'api-3')!;
  assert.ok(dead.counts.transportFailed > 0);
  assert.equal(dead.counts.rejected, 0);
  assert.equal(dead.counts.unknownDecision, dead.counts.transportFailed);
  assert.equal(failed.counts.inFlight, 0);
  assert.equal(failed.counts.dispatched, failed.counts.allowed + failed.counts.rejected + failed.counts.unknownDecision);
  assert.equal(failed.counts.dispatched, failed.instances!.reduce((sum, item) => sum + item.counts.dispatched, 0));
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(config) })).status, 503);
});
