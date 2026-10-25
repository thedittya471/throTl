import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFixedWindowLimiter } from '../../src/limiters/fixed-window.ts';

test('allows the configured count and rejects further requests without consuming allowance', () => {
  const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1_000, now: () => 100 });
  const first = limiter.check('alice');
  const second = limiter.check('alice');
  const third = limiter.check('alice');
  const fourth = limiter.check('alice');

  assert.equal(first.allowed, true);
  assert.equal(first.reason, 'within_limit');
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(second.retryAfterMs, 0);
  assert.equal(third.allowed, false);
  assert.equal(third.reason, 'limit_exhausted');
  assert.equal(third.remaining, 0);
  assert.equal(third.retryAfterMs, 900);
  assert.equal(third.resetAtMs, 1_000);
  assert.equal(third.state.countBefore, 2);
  assert.equal(third.state.countAfter, 2);
  assert.deepEqual(fourth, third);
});

test('starts a fresh window at the exact boundary and after long idle periods', () => {
  let nowMs = 999;
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1_000, now: () => nowMs });
  assert.equal(limiter.check('alice').allowed, true);
  assert.equal(limiter.check('alice').allowed, false);
  nowMs = 1_000;
  const boundary = limiter.check('alice');
  assert.equal(boundary.allowed, true);
  assert.equal(boundary.state.countBefore, 0);
  assert.equal(boundary.state.windowStartMs, 1_000);
  assert.equal(boundary.resetAtMs, 2_000);
  nowMs = 100_500;
  const afterIdle = limiter.check('alice');
  assert.equal(afterIdle.allowed, true);
  assert.equal(afterIdle.state.windowStartMs, 100_000);
  assert.equal(afterIdle.resetAtMs, 101_000);
});

test('keeps keys and limiter instances independent', () => {
  const options = { limit: 1, windowMs: 1_000, now: () => 0 };
  const first = createFixedWindowLimiter(options);
  const second = createFixedWindowLimiter(options);
  assert.equal(first.check('alice').allowed, true);
  assert.equal(first.check('alice').allowed, false);
  assert.equal(first.check('bob').allowed, true);
  assert.equal(second.check('alice').allowed, true);
});

test('clamps clock rollback per key without reopening a previous window', () => {
  let nowMs = 1_100;
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1_000, now: () => nowMs });
  limiter.check('alice');
  nowMs = 900;
  const rollback = limiter.check('alice');
  assert.equal(rollback.allowed, false);
  assert.equal(rollback.state.rawTimeMs, 900);
  assert.equal(rollback.state.effectiveTimeMs, 1_100);
  assert.equal(rollback.state.clockClamped, true);
  assert.equal(rollback.resetAtMs, 2_000);
  assert.equal(rollback.retryAfterMs, 1_100);
  assert.equal(limiter.check('bob').state.effectiveTimeMs, 900);
  nowMs = 2_000;
  const recovered = limiter.check('alice');
  assert.equal(recovered.allowed, true);
  assert.equal(recovered.state.clockClamped, false);
});

test('returns independent snapshots of the before and after counts', () => {
  const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1_000, now: () => 100 });
  const first = limiter.check('alice');
  assert.deepEqual(first.state, {
    limit: 2, windowStartMs: 0, countBefore: 0, countAfter: 1,
    rawTimeMs: 100, effectiveTimeMs: 100, clockClamped: false,
  });
  limiter.check('alice');
  assert.equal(first.state.countAfter, 1);
  first.state.countAfter = 999;
  assert.equal(limiter.check('alice').state.countBefore, 2);
});

test('demonstrates two full bursts across a fixed-window boundary', () => {
  let nowMs = 0;
  const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1_000, now: () => nowMs });
  const allowed = [998, 999, 1_000, 1_001].map((time) => {
    nowMs = time;
    return limiter.check('global').allowed;
  });
  assert.deepEqual(allowed, [true, true, true, true]);
  assert.equal(limiter.check('global').allowed, false);
});

test('rejects invalid limit and duration values', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createFixedWindowLimiter({ limit: value, windowMs: 1_000 }), /limit/);
    assert.throws(() => createFixedWindowLimiter({ limit: 1, windowMs: value }), /windowMs/);
  }
});

test('rejects invalid clock values without mutating the stored allowance', () => {
  let nowMs = 100;
  const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1_000, now: () => nowMs });
  limiter.check('alice');
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    nowMs = value;
    assert.throws(() => limiter.check('alice'), /clock/);
  }
  nowMs = 200;
  assert.equal(limiter.check('alice').remaining, 0);
});

test('rejects an unsafe reset timestamp without creating state', () => {
  let nowMs = Number.MAX_SAFE_INTEGER;
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1_000, now: () => nowMs });
  assert.throws(() => limiter.check('alice'), /reset/);
  nowMs = 0;
  assert.equal(limiter.check('alice').allowed, true);
});

test('rejects empty keys', () => {
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 1_000 });
  assert.throws(() => limiter.check(''), /key/);
});

test('uses the default clock and captures configuration at construction', () => {
  const options = { limit: 1, windowMs: 1_000 };
  const limiter = createFixedWindowLimiter(options);
  options.limit = 100;
  options.windowMs = 100_000;
  const decision = limiter.check('alice');
  assert.equal(decision.allowed, true);
  assert.equal(decision.remaining, 0);
  assert.equal(decision.state.limit, 1);
  assert.equal(decision.resetAtMs - decision.state.windowStartMs, 1_000);
});
