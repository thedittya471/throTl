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
