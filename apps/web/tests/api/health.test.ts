import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET } from '../../app/api/health/route.ts';

const health = { version: 1, status: 'ok', service: 'ratelab-api' };

test('health bridge validates the upstream response and disables caching', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(health));
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), health);
});

test('health bridge reports unavailable upstream without leaking internal details', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private upstream credentials'); });
  const response = await GET();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'API_UNAVAILABLE' });
});

test('health bridge rejects an incompatible API contract', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...health, version: 2 }));
  const response = await GET();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'API_INCOMPATIBLE' });
});

test('health bridge rejects non-success HTTP responses', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('upstream error', { status: 500 }));
  const response = await GET();
  assert.equal(response.status, 503);
});
