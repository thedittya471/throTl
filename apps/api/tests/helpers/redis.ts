import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { TestContext } from 'node:test';
import { createClient } from 'redis';

export async function startRedis(t: TestContext) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.env.REDIS_SERVER_BIN ?? 'redis-server', ['--bind', '127.0.0.1', '--port', String(address.port),
    '--save', '', '--appendonly', 'no', '--maxmemory-policy', 'noeviction'], { stdio: ['ignore', 'pipe', 'pipe'] });
  async function stop() {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const deadline = setTimeout(() => child.kill('SIGKILL'), 3_000);
    try { await exited; } finally { clearTimeout(deadline); }
  }
  t.after(stop);
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Test Redis startup timed out')), 5_000);
    child.once('error', () => { clearTimeout(deadline); reject(new Error('Install redis-server or set REDIS_SERVER_BIN to run Redis tests')); });
    child.once('exit', () => { clearTimeout(deadline); reject(new Error('Test Redis exited before listening')); });
    child.stdout!.on('data', (chunk) => {
      if (String(chunk).includes('Ready to accept connections')) { clearTimeout(deadline); resolve(); }
    });
  });
  const url = `redis://127.0.0.1:${address.port}`;
  const admin = createClient({ url, socket: { reconnectStrategy: false }, disableOfflineQueue: true });
  admin.on('error', () => {});
  t.after(() => { if (admin.isOpen) admin.destroy(); });
  await admin.connect();
  return { url, admin, stop };
}
