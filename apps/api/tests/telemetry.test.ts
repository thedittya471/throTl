import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DECISION_DETAILS, MAX_TIMELINE_POINTS, parseRunTelemetry, parseRunSnapshot, DEFAULT_RUN_CONFIG } from '@ratelab/contracts';
import { createRunCounts } from '../src/traffic.ts';
import { createRunTelemetry } from '../src/telemetry.ts';
import { createFixedWindowLimiter } from '../src/limiters/fixed-window.ts';

test('telemetry explains exhaustion and reset using actual decisions and one-second buckets', () => {
  let time = 0;
  const telemetry = createRunTelemetry(() => time);
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1_000, now: () => time });
  telemetry.record(limiter.check('global'));
  time = 100;
  telemetry.record(limiter.check('global'));
  time = 1_000;
  telemetry.record(limiter.check('global'));
  assert.deepEqual(telemetry.data.timeline, [
    { elapsedMs: 0, allowed: 1, rejected: 1 }, { elapsedMs: 1_000, allowed: 1, rejected: 0 },
  ]);
  assert.equal(telemetry.data.recent[1]!.decision.reason, 'limit_exhausted');
  assert.equal(telemetry.data.recent[2]!.decision.state.windowStartMs, 1_000);
  assert.equal(telemetry.data.recent[0]!.decision.state.countAfter, 1);
  assert.equal(parseRunTelemetry(telemetry.data).evaluated, 3);
});

test('telemetry retains bounded history without sampling aggregate counts', () => {
  let time = 0;
  const telemetry = createRunTelemetry(() => time);
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1_000, now: () => time });
  for (let index = 0; index < 1_000; index++) {
    time = index * 1_000;
    telemetry.record(limiter.check('global'));
  }
  assert.equal(telemetry.data.evaluated, 1_000);
  assert.equal(telemetry.data.allowed, 1_000);
  assert.equal(telemetry.data.recent.length, MAX_DECISION_DETAILS);
  assert.equal(telemetry.data.timeline.length, MAX_TIMELINE_POINTS);
  assert.equal(telemetry.data.recent[0]!.sequence, 951);
  const snapshot = { version: 1, id: 'a'.repeat(32), status: 'completed', config: DEFAULT_RUN_CONFIG,
    counts: createRunCounts(DEFAULT_RUN_CONFIG), telemetry: telemetry.data };
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 64 * 1_024);
  assert.equal(parseRunSnapshot(snapshot).telemetry!.evaluated, 1_000);
});
