import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RUN_CONFIG, parseRunConfig, parseRunSnapshot } from '../src/runs.ts';

test('run configuration accepts bounded integers and rejects incomplete or arbitrary settings', () => {
  assert.deepEqual(parseRunConfig(DEFAULT_RUN_CONFIG), DEFAULT_RUN_CONFIG);
  for (const input of [null, [], {}, { ...DEFAULT_RUN_CONFIG, target: 'http://example.com' },
    { ...DEFAULT_RUN_CONFIG, ratePerSecond: 0 }, { ...DEFAULT_RUN_CONFIG, durationMs: 120_001 },
    { ...DEFAULT_RUN_CONFIG, limit: 1.5 }, { ...DEFAULT_RUN_CONFIG, windowMs: Infinity }]) {
    assert.throws(() => parseRunConfig(input));
  }
});

test('run response parser rejects invalid identities, states, and counters', () => {
  for (const input of [null, {}, { version: 2 }, { version: 1, id: 'secret', status: 'completed', counts: {} },
    { version: 1, id: 'a'.repeat(32), status: 'completed', counts: {} }]) {
    assert.throws(() => parseRunSnapshot(input));
  }
});

test('run response validates bounded instance identities and per-instance counters', () => {
  const run = { version: 1, id: 'a'.repeat(32), status: 'completed', config: DEFAULT_RUN_CONFIG,
    counts: { scheduled: 0, dispatched: 0, responseReceived: 0, allowed: 0, rejected: 0, unknownDecision: 0,
      transportFailed: 0, cancelled: 0, timedOut: 0, inFlight: 0, missed: 0, missedLate: 0, missedInFlight: 0, missedCancelled: 0 } };
  const instance = { id: 'api-1', counts: run.counts };
  assert.equal(parseRunSnapshot({ ...run, instances: [instance] }).instances![0]!.id, 'api-1');
  for (const instances of [[], [instance, instance], [{ ...instance, id: 'bad id' }],
    [{ ...instance, counts: { ...run.counts, allowed: -1 } }]]) {
    assert.throws(() => parseRunSnapshot({ ...run, instances }));
  }
});
