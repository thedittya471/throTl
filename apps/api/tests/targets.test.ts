import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../src/server.ts';

const config = { durationMs: 100, ratePerSecond: 10, limit: 1, windowMs: 60_000 };

test('target registration requires the private secret, bounds state, and removes credentials on cleanup', async (t) => {
  const secret = 'a'.repeat(64);
  const app = createApp({ now: () => 100 }, { instanceId: 'api-2', peers: [], secret });
  const server = createServer(app);
  t.after(() => server.close());
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/internal/runs`;
  const token = `Bearer ${'b'.repeat(64)}`;
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  const register = (value: unknown, auth = headers) => fetch(url, { method: 'POST', headers: auth, body: JSON.stringify(value) });
  assert.equal((await register({ token, config }, { ...headers, Authorization: token })).status, 404);
  assert.equal((await register({ token: 'weak', config })).status, 400);
  assert.equal((await register({ token, config })).status, 201);
  assert.equal((await register({ token, config })).status, 400);
  assert.equal((await fetch(`${url}/target`, { headers })).status, 404);
  const targetHeaders = { Authorization: token };
  assert.equal((await fetch(`${url}/target`, { method: 'HEAD', headers: targetHeaders })).status, 405);
  assert.equal((await fetch(`${url}/target?limit=100`, { headers: targetHeaders })).status, 404);
  const allowed = await fetch(`${url}/target`, { headers: targetHeaders });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('x-ratelab-instance'), 'api-2');
  assert.equal((await allowed.json()).instance, 'api-2');
  assert.equal((await fetch(`${url}/target`, { headers: targetHeaders })).status, 429);
  for (let index = 0; index < 9; index++) {
    assert.equal((await register({ token: `Bearer ${String(index).padStart(64, '0')}`, config })).status, 201);
  }
  assert.equal((await register({ token: `Bearer ${'c'.repeat(64)}`, config })).status, 400);
  assert.equal((await fetch(url, { method: 'DELETE', headers, body: JSON.stringify({ token }) })).status, 204);
  assert.equal((await fetch(`${url}/target`, { headers: targetHeaders })).status, 404);
  assert.equal((await register({ token, config })).status, 201);
});
