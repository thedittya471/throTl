import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { test } from 'node:test';
import { DEFAULT_RUN_CONFIG, type RunSnapshot } from '@ratelab/contracts';
import { createRunCounts } from '../src/traffic.ts';
import { createRunEvents } from '../src/events.ts';

class SlowResponse extends EventEmitter {
  writableLength = 0;
  destroyed = false;
  writableEnded = false;
  frames: string[] = [];
  writeHead() {}
  setTimeout() {}
  flushHeaders() {}
  write(frame: string) { this.frames.push(frame); return false; }
  end() { this.writableEnded = true; }
  destroy() { this.destroyed = true; this.emit('close'); }
}
function snapshot(): RunSnapshot {
  return { version: 1, id: 'a'.repeat(32), status: 'running', config: DEFAULT_RUN_CONFIG,
    counts: createRunCounts(DEFAULT_RUN_CONFIG) };
}

test('slow readers do not accumulate snapshots and drain receives only the latest totals', async () => {
  const run = snapshot();
  const events = createRunEvents(run, () => {}, { intervalMs: 5 });
  const response = new SlowResponse();
  events.connect(response as unknown as ServerResponse);
  run.counts.dispatched = 7;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(response.frames.length, 1);
  response.emit('drain');
  assert.equal(response.frames.length, 2);
  assert.match(response.frames[1]!, /"dispatched":7/);
  events.close();
  assert.equal(response.listenerCount('drain'), 0);
});

test('stalled readers are closed and disconnected runs stop after the grace period', async () => {
  let stops = 0;
  const events = createRunEvents(snapshot(), () => stops++, { graceMs: 15, intervalMs: 5, slowReaderMs: 10 });
  const response = new SlowResponse();
  events.connect(response as unknown as ServerResponse);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(response.destroyed, true);
  assert.equal(stops, 1);
  events.close();
});

test('replacing a stream removes old listeners and clears its disconnect deadline', async () => {
  let stops = 0;
  const events = createRunEvents(snapshot(), () => stops++, { graceMs: 10, slowReaderMs: 200 });
  const first = new SlowResponse();
  const second = new SlowResponse();
  events.connect(first as unknown as ServerResponse);
  events.connect(second as unknown as ServerResponse);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(first.destroyed, true);
  assert.equal(first.listenerCount('close'), 0);
  assert.equal(stops, 0);
  events.close();
});

test('final status is sent after backpressure clears and terminal reconnect gets one final snapshot', () => {
  const run = snapshot();
  const events = createRunEvents(run, () => {});
  const response = new SlowResponse();
  events.connect(response as unknown as ServerResponse);
  run.status = 'stopped';
  events.finish();
  assert.equal(response.frames.length, 1);
  assert.equal(response.writableEnded, false);
  response.write = (frame: string) => { response.frames.push(frame); return true; };
  response.emit('drain');
  assert.match(response.frames.at(-1)!, /"status":"stopped"/);
  assert.equal(response.writableEnded, true);
  const reconnected = new SlowResponse();
  reconnected.write = (frame: string) => { reconnected.frames.push(frame); return true; };
  events.connect(reconnected as unknown as ServerResponse);
  assert.equal(reconnected.frames.length, 1);
  assert.equal(reconnected.writableEnded, true);
  events.close();
});

test('streams include periodic heartbeat comments', async (t) => {
  const originalNow = Date.now;
  let time = originalNow();
  t.mock.method(Date, 'now', () => time);
  const events = createRunEvents(snapshot(), () => {}, { intervalMs: 5 });
  const response = new SlowResponse();
  response.write = (frame: string) => { response.frames.push(frame); return true; };
  events.connect(response as unknown as ServerResponse);
  time += 10_000;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(response.frames.some((frame) => frame.startsWith(': heartbeat\n\n')));
  events.close();
});
