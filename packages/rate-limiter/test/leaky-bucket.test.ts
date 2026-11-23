import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LeakyBucketLimiter } from "../dist/index.js";

describe("LeakyBucketLimiter", () => {
  it("admits requests up to capacity from empty bucket", async () => {
    const limiter = new LeakyBucketLimiter({ capacity: 5, leakRatePerSec: 1 });
    const key = "user-1";
    const timestamp = 1000;

    for (let i = 1; i <= 5; i++) {
      const result = await limiter.evaluate({ key, timestampMs: timestamp });

      assert.equal(result.allowed, true);
      assert.equal(result.remaining, 5 - i);
      assert.equal(result.internalState.level, i);
    }

    const overflowResult = await limiter.evaluate({ key, timestampMs: timestamp });
    assert.equal(overflowResult.allowed, false);
    assert.equal(overflowResult.remaining, 0);
  });

  it("leaks water continuously over time creating capacity", async () => {
    // Capacity 4, leaks 2 units per second (1 unit every 500ms)
    const limiter = new LeakyBucketLimiter({ capacity: 4, leakRatePerSec: 2 });
    const key = "user-1";

    // Fill capacity 4 at t = 0
    for (let i = 0; i < 4; i++) {
      await limiter.evaluate({ key, timestampMs: 0 });
    }

    // Immediately at t = 100ms: only 0.2 leaked, not enough for 1 unit
    const resImmediate = await limiter.evaluate({ key, timestampMs: 100 });
    assert.equal(resImmediate.allowed, false);

    // At t = 1,000ms: 2 units have leaked out (level dropped from 4 to 2)
    const res1 = await limiter.evaluate({ key, timestampMs: 1000 });
    assert.equal(res1.allowed, true); // level becomes 3
    assert.equal(res1.remaining, 1);

    const res2 = await limiter.evaluate({ key, timestampMs: 1000 });
    assert.equal(res2.allowed, true); // level becomes 4 (full)
    assert.equal(res2.remaining, 0);

    const res3 = await limiter.evaluate({ key, timestampMs: 1000 });
    assert.equal(res3.allowed, false); // full again
  });

  it("does not allow level to drop below zero after long idle", async () => {
    const limiter = new LeakyBucketLimiter({ capacity: 5, leakRatePerSec: 10 });
    const key = "user-1";

    // Add 2 units at t = 0
    await limiter.evaluate({ key, timestampMs: 0, cost: 2 });

    // Idle for 1000 seconds
    const state = await limiter.evaluate({ key, timestampMs: 1_000_000, cost: 1 });

    assert.equal(state.allowed, true);
    assert.equal(state.internalState.level, 1);
    assert.equal(state.remaining, 4);
  });

  it("calculates accurate retryAfterSec based on required leak time", async () => {
    // Capacity 2, leaks 1 unit per second
    const limiter = new LeakyBucketLimiter({ capacity: 2, leakRatePerSec: 1 });
    const key = "user-1";

    // Fill to 2 units at t = 0
    await limiter.evaluate({ key, timestampMs: 0, cost: 2 });

    // Request cost 2 at t = 0. Current level 2 + 2 = 4. Capacity 2 -> overflow = 2 -> 2 seconds wait
    const blocked = await limiter.evaluate({ key, timestampMs: 0, cost: 2 });

    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSec, 2);
  });

  it("tracks state independently across different keys", async () => {
    const limiter = new LeakyBucketLimiter({ capacity: 1, leakRatePerSec: 1 });

    const resA = await limiter.evaluate({ key: "client-a", timestampMs: 0 });
    const resB = await limiter.evaluate({ key: "client-b", timestampMs: 0 });

    assert.equal(resA.allowed, true);
    assert.equal(resB.allowed, true);
  });

  it("clears state when reset is called", async () => {
    const limiter = new LeakyBucketLimiter({ capacity: 1, leakRatePerSec: 1 });
    const key = "user-1";

    await limiter.evaluate({ key, timestampMs: 0 });
    await limiter.reset(key);

    const afterReset = await limiter.evaluate({ key, timestampMs: 0 });
    assert.equal(afterReset.allowed, true);
  });
});
