import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DECISION_DETAILS, MAX_TIMELINE_POINTS, parseRunTelemetry } from '../src/telemetry.ts';

const empty = { evaluated: 0, allowed: 0, rejected: 0, timeline: [], recent: [] };

test('telemetry contract rejects invalid counters, oversized histories, and malformed decisions', () => {
  assert.deepEqual(parseRunTelemetry(empty), empty);
  for (const input of [null, {}, { ...empty, evaluated: 1 }, { ...empty, allowed: -1 },
    { ...empty, timeline: Array(MAX_TIMELINE_POINTS + 1).fill({}) },
    { ...empty, recent: Array(MAX_DECISION_DETAILS + 1).fill({}) },
    { ...empty, recent: [{ sequence: 1, decision: {} }] },
    { ...empty, timeline: [{ elapsedMs: NaN, allowed: 0, rejected: 0 }] }]) {
    assert.throws(() => parseRunTelemetry(input));
  }
});

test('telemetry rejects unordered time buckets and inconsistent before/after evidence', () => {
  const decision = { allowed: true, reason: 'within_limit', remaining: 0, resetAtMs: 1_000, retryAfterMs: 0,
    state: { limit: 1, windowStartMs: 0, countBefore: 0, countAfter: 1, rawTimeMs: 100,
      effectiveTimeMs: 100, clockClamped: false } };
  const data = { evaluated: 1, allowed: 1, rejected: 0,
    timeline: [{ elapsedMs: 0, allowed: 1, rejected: 0 }],
    recent: [{ sequence: 1, elapsedMs: 0, decision }] };
  assert.equal(parseRunTelemetry(data).recent.length, 1);
  for (const input of [
    { ...data, timeline: [{ elapsedMs: 1, allowed: 1, rejected: 0 }] },
    { ...data, timeline: [data.timeline[0], data.timeline[0]] },
    { ...data, recent: [data.recent[0], data.recent[0]] },
    { ...data, recent: [{ sequence: 1, elapsedMs: 0, decision: { ...decision, remaining: 1 } }] },
    { ...data, recent: [{ sequence: 1, elapsedMs: 0, decision: { ...decision, state: { ...decision.state, countAfter: 0 } } }] },
  ]) assert.throws(() => parseRunTelemetry(input));
});
