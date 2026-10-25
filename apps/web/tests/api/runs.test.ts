import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RUN_CONFIG } from '@ratelab/contracts';
import { POST, GET, DELETE } from '../../app/api/runs/route.ts';

const snapshot = { version: 1, id: 'a'.repeat(32), status: 'completed', config: DEFAULT_RUN_CONFIG,
  counts: { scheduled: 1, dispatched: 1, responseReceived: 1, allowed: 1, rejected: 0,
    unknownDecision: 0, transportFailed: 0, cancelled: 0, timedOut: 0, inFlight: 0,
    missed: 0, missedLate: 0, missedInFlight: 0, missedCancelled: 0 } };
const token = 'b'.repeat(64);

test('run bridge validates start and forwards only the server-owned API destination', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    assert.equal(url.pathname, '/runs');
    assert.equal(options.method, 'POST');
    assert.equal(new Headers(options.headers).get('X-RateLab-Request'), '1');
    assert.deepEqual(JSON.parse(String(options.body)), DEFAULT_RUN_CONFIG);
    return Response.json({ run: snapshot, token });
  });
  const response = await POST(new Request('http://localhost/api/runs', { method: 'POST',
    headers: { Origin: 'http://localhost' }, body: JSON.stringify(DEFAULT_RUN_CONFIG) }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { run: snapshot, token });
});

test('run bridge blocks cross-origin changes, missing credentials, and invalid input before fetching', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not fetch'); });
  assert.equal((await POST(new Request('http://localhost/api/runs', { method: 'POST',
    headers: { Origin: 'https://other.example' }, body: '{}' }))).status, 403);
  assert.equal((await DELETE(new Request('http://localhost/api/runs', { method: 'DELETE' }))).status, 403);
  assert.equal((await GET(new Request('http://localhost/api/runs'))).status, 404);
  for (const body of ['{broken', '{}', ' '.repeat(2_000), JSON.stringify({ ...DEFAULT_RUN_CONFIG, target: 'http://other' })]) {
    assert.equal((await POST(new Request('http://localhost/api/runs', { method: 'POST',
      headers: { Origin: 'http://localhost' }, body }))).status, 400);
  }
});

test('run bridge forwards credentials for status and stop and validates replies', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: URL, options: RequestInit) => {
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${token}`);
    return Response.json(snapshot);
  });
  for (const [method, handler] of [['GET', GET], ['DELETE', DELETE]] as const) {
    const response = await handler(new Request('http://localhost/api/runs', { method,
      headers: { Origin: 'http://localhost', Authorization: `Bearer ${token}` } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), snapshot);
  }
});

test('run bridge hides upstream errors and rejects incompatible responses', async (t) => {
  const request = () => new Request('http://localhost/api/runs', { headers: { Authorization: `Bearer ${token}` } });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ private: 'secret' }, { status: 500 }));
  assert.deepEqual(await (await GET(request())).json(), { error: 'RUN_REQUEST_FAILED' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...snapshot, version: 2 }));
  assert.equal((await GET(request())).status, 503);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private URL'); });
  assert.deepEqual(await (await GET(request())).json(), { error: 'RUN_API_UNAVAILABLE' });
});
