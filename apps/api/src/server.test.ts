import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createApp, readConfig } from './server.ts';

test('configuration uses local defaults', () => {
  assert.deepEqual(readConfig({}), { host: '127.0.0.1', port: 3001 });
});

test('configuration accepts explicit bind addresses and valid port boundaries', () => {
  for (const host of ['localhost', '0.0.0.0', '::1']) {
    for (const port of ['1', '65535']) {
      assert.deepEqual(readConfig({ HOST: host, PORT: port }), { host, port: Number(port) });
    }
  }
});

test('configuration rejects malformed or out-of-range ports without echoing input', () => {
  for (const port of ['', '0', '-1', '65536', '1.5', '3e3', ' 3001 ', '3001oops', 'secret']) {
    assert.throws(() => readConfig({ PORT: port }), {
      message: 'PORT must be an integer between 1 and 65535',
    });
  }
});

test('configuration rejects invalid bind addresses', () => {
  for (const host of ['', ' ', 'https://localhost', '127.0.0.999']) {
    assert.throws(() => readConfig({ HOST: host }), {
      message: 'HOST must be an IP address or localhost',
    });
  }
});

test('health endpoint returns JSON without exposing configuration', async (t) => {
  const server = createServer(createApp());
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { status: 'ok', service: 'ratelab-api' });
});


test('startup exits unsuccessfully for invalid configuration', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./index.ts', import.meta.url))], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: 'invalid' },
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PORT must be an integer between 1 and 65535/);
  assert.equal(result.stdout, '');
});

test('startup reports an occupied port and exits unsuccessfully', async (t) => {
  const occupied = createServer();
  t.after(() => new Promise<void>((resolve, reject) => {
    occupied.close((error) => error ? reject(error) : resolve());
  }));
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const address = occupied.address();
  assert.ok(address && typeof address !== 'string');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./index.ts', import.meta.url))], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(address.port) },
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /API failed to listen: EADDRINUSE/);
  assert.equal(result.stdout, '');
});
