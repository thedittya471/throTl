import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TokenBucketLimiter } from "../dist/index.js";

describe("TokenBucketLimiter", () => {
  it("allows immediate burst up to capacity", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 5, refillRatePerSec: 1 });
    const key = "user-1";
    const timestamp = 1000;

    for (let i = 1; i <= 5; i++) {
      const result = await limiter.evaluate({ key, timestampMs: timestamp });

      assert.equal(result.allowed, true);
      assert.equal(result.remaining, 5 - i);
    }

    const blocked = await limiter.evaluate({ key, timestampMs: timestamp });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
  });

  it("refills tokens smoothly over time", async () => {
    // Capacity 10, refill rate 2 tokens per second (1 token every 500ms)
    const limiter = new TokenBucketLimiter({ capacity: 10, refillRatePerSec: 2 });
    const key = "user-1";

    // Drain all 10 tokens at t = 0
    for (let i = 0; i < 10; i++) {
      await limiter.evaluate({ key, timestampMs: 0 });
    }

    // Immediately at t = 100ms: still empty
    const resImmediate = await limiter.evaluate({ key, timestampMs: 100 });
    assert.equal(resImmediate.allowed, false);

    // At t = 1,000ms: 2 tokens should have refilled
    const res1 = await limiter.evaluate({ key, timestampMs: 1000 });
    assert.equal(res1.allowed, true);
    assert.equal(res1.remaining, 1);

    const res2 = await limiter.evaluate({ key, timestampMs: 1000 });
    assert.equal(res2.allowed, true);
    assert.equal(res2.remaining, 0);

    const res3 = await limiter.evaluate({ key, timestampMs: 1000 });
    assert.equal(res3.allowed, false);
  });

  it("caps tokens at maximum capacity during long idle periods", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 5, refillRatePerSec: 10 });
    const key = "user-1";

    // Start with 5 tokens at t = 0, consume 2
    await limiter.evaluate({ key, timestampMs: 0, cost: 2 });

    // Idle for 100 seconds (would be 1000 tokens if uncapped)
    const resAfterIdle = await limiter.evaluate({ key, timestampMs: 100_000, cost: 1 });

    assert.equal(resAfterIdle.allowed, true);
    assert.equal(resAfterIdle.remaining, 4); // 5 - 1 = 4
  });

  it("calculates accurate retryAfterSec based on token deficit", async () => {
    // Refill 1 token per second
    const limiter = new TokenBucketLimiter({ capacity: 1, refillRatePerSec: 1 });
    const key = "user-1";

    await limiter.evaluate({ key, timestampMs: 0 }); // consumes the 1 token

    // Request cost 3 tokens at t = 0. Tokens = 0, need 3 -> deficit 3 -> 3 seconds
    const blocked = await limiter.evaluate({ key, timestampMs: 0, cost: 3 });

    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSec, 3);
  });

  it("tracks state independently across different keys", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillRatePerSec: 1 });

    const resA = await limiter.evaluate({ key: "client-a", timestampMs: 0 });
    const resB = await limiter.evaluate({ key: "client-b", timestampMs: 0 });

    assert.equal(resA.allowed, true);
    assert.equal(resB.allowed, true);
  });

  it("clears state when reset is called", async () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, refillRatePerSec: 1 });
    const key = "user-1";

    await limiter.evaluate({ key, timestampMs: 0 });
    await limiter.reset(key);

    const afterReset = await limiter.evaluate({ key, timestampMs: 0 });
    assert.equal(afterReset.allowed, true);
  });
});
