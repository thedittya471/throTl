import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { generateTraffic, createRunCounts } from '../src/traffic.ts';

const config = { durationMs: 200, ratePerSecond: 100, limit: 2, windowMs: 1_000 };

test('generator bounds in-flight work and settles cancelled requests before returning', async (t) => {
  let arrivals = 0;
  const server = createServer((_request, response) => {
    arrivals++;
    response.writeHead(200, { 'X-RateLab-Decision': 'allowed' });
    response.write('waiting');
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const controller = new AbortController();
  const counts = createRunCounts(config);
  const work = generateTraffic({ config, counts, target: new URL(`http://127.0.0.1:${address.port}`),
    token: 'test', signal: controller.signal, onDraining() {}, maxInFlight: 1 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  controller.abort();
  await work;
  assert.equal(counts.inFlight, 0);
  assert.ok(arrivals <= 1);
  assert.ok(counts.missedInFlight > 0);
  assert.equal(counts.dispatched, counts.cancelled);
  assert.equal(counts.allowed + counts.rejected, 0);
  assert.equal(counts.scheduled, counts.dispatched + counts.missed);
  const snapshot = { ...counts };
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(counts, snapshot);
});

test('generator reports a broken connection as transport failure, not a rejection', async (t) => {
  const server = createServer((request) => request.socket.destroy());
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const single = { ...config, durationMs: 100, ratePerSecond: 1 };
  const counts = createRunCounts(single);
  await generateTraffic({ config: single, counts, target: new URL(`http://127.0.0.1:${address.port}`),
    token: 'test', signal: new AbortController().signal, onDraining() {} });
  assert.equal(counts.transportFailed, 1);
  assert.equal(counts.rejected, 0);
  assert.equal(counts.unknownDecision, 1);
  assert.equal(counts.inFlight, 0);
});

test('generator reuses a keep-alive connection for sequential requests', async (t) => {
  let connections = 0;
  const server = createServer((_request, response) => {
    response.setHeader('X-RateLab-Decision', 'allowed');
    response.end('ok');
  });
  server.on('connection', () => connections++);
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const settings = { ...config, durationMs: 200, ratePerSecond: 10 };
  const counts = createRunCounts(settings);
  await generateTraffic({ config: settings, counts, target: new URL(`http://127.0.0.1:${address.port}`),
    token: 'test', signal: new AbortController().signal, onDraining() {} });
  assert.equal(counts.allowed, 2);
  assert.equal(connections, 1);
});

test('generator times out an incomplete response and reports an unknown decision', async (t) => {
  const server = createServer((_request, response) => response.write('incomplete'));
  t.after(() => { server.closeAllConnections(); server.close(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const settings = { ...config, durationMs: 100, ratePerSecond: 1 };
  const counts = createRunCounts(settings);
  await generateTraffic({ config: settings, counts, target: new URL(`http://127.0.0.1:${address.port}`),
    token: 'test', signal: new AbortController().signal, onDraining() {}, timeoutMs: 30 });
  assert.equal(counts.timedOut, 1);
  assert.equal(counts.unknownDecision, 1);
  assert.equal(counts.responseReceived, 0);
  assert.equal(counts.inFlight, 0);
});

test('generator counts capacity misses without dispatching when the global budget is full', async () => {
  const settings = { ...config, durationMs: 100, ratePerSecond: 1 };
  const counts = createRunCounts(settings);
  await generateTraffic({ config: settings, counts, target: new URL('http://127.0.0.1:1'),
    token: 'test', signal: new AbortController().signal, onDraining() {}, canDispatch: () => false });
  assert.equal(counts.dispatched, 0);
  assert.equal(counts.missedInFlight, 1);
  assert.equal(counts.missed, counts.scheduled);
});
