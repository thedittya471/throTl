import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHealthResponse } from './index.ts';

test('health contract accepts the supported version and service', () => {
  const health = { version: 1, status: 'ok', service: 'ratelab-api' };
  assert.deepEqual(parseHealthResponse(health), health);
});

test('health contract rejects malformed or incompatible responses', () => {
  for (const input of [null, [], 'ok', {},
    { version: 2, status: 'ok', service: 'ratelab-api' },
    { version: 1, status: 'error', service: 'ratelab-api' },
    { version: 1, status: 'ok', service: 'another-api' },
  ]) {
    assert.throws(() => parseHealthResponse(input), /Unsupported API health response/);
  }
});
