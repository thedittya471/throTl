import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowCounterLimiter } from "../dist/index.js";

describe("SlidingWindowCounterLimiter", () => {
  it("admits requests up to limit within single window", async () => {
    const limiter = new SlidingWindowCounterLimiter({ limit: 5, windowSizeMs: 1000 });
    const key = "user-1";
    const timestamp = 100;

    for (let i = 1; i <= 5; i++) {
      const result = await limiter.evaluate({ key, timestampMs: timestamp });

      assert.equal(result.allowed, true);
      assert.equal(result.internalState.currCount, i);
    }

    const blocked = await limiter.evaluate({ key, timestampMs: timestamp });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
  });

  it("smooths boundary transition with weighted interpolation", async () => {
    const limiter = new SlidingWindowCounterLimiter({ limit: 100, windowSizeMs: 60_000 });
    const key = "user-1";

    // Fill current window (window 0) with 100 requests at 50,000ms
    for (let i = 0; i < 100; i++) {
      await limiter.evaluate({ key, timestampMs: 50_000 });
    }

    // Advance to window 1 at 75,000ms (15,000ms elapsed into 60,000ms window -> 25% elapsed)
    // prevWeight = 1 - (15000 / 60000) = 0.75
    // estimated from prev = 100 * 0.75 = 75
    // Therefore, exactly 25 requests should be allowed in the new window at this timestamp!
    let admittedInWindow2 = 0;
    for (let i = 0; i < 40; i++) {
      const res = await limiter.evaluate({ key, timestampMs: 75_000 });
      if (res.allowed) admittedInWindow2++;
    }

    assert.equal(admittedInWindow2, 25);
  });

  it("prevents boundary burst from admitting 200 requests", async () => {
    const limiter = new SlidingWindowCounterLimiter({ limit: 100, windowSizeMs: 60_000 });
    const key = "attacker";

    let admittedWindow1 = 0;
    for (let i = 0; i < 100; i++) {
      const res = await limiter.evaluate({ key, timestampMs: 59_900 });
      if (res.allowed) admittedWindow1++;
    }

    // Try sending 100 requests immediately across the boundary at 60,100ms
    // elapsed is 100ms into window 1. prevWeight is 1 - (100 / 60000) = 0.9983
    // estimated = 100 * 0.9983 = 99.83.
    // Almost all new requests will be blocked!
    let admittedWindow2 = 0;
    for (let i = 0; i < 100; i++) {
      const res = await limiter.evaluate({ key, timestampMs: 60_100 });
      if (res.allowed) admittedWindow2++;
    }

    assert.equal(admittedWindow1, 100);
    assert.equal(admittedWindow2, 0);
    assert.equal(admittedWindow1 + admittedWindow2, 100);
  });

  it("tracks state independently across different keys", async () => {
    const limiter = new SlidingWindowCounterLimiter({ limit: 2, windowSizeMs: 1000 });

    const user1 = await limiter.evaluate({ key: "u1", timestampMs: 100 });
    const user2 = await limiter.evaluate({ key: "u2", timestampMs: 100 });

    assert.equal(user1.allowed, true);
    assert.equal(user2.allowed, true);
  });

  it("clears state when reset is called", async () => {
    const limiter = new SlidingWindowCounterLimiter({ limit: 1, windowSizeMs: 1000 });
    const key = "user-1";

    await limiter.evaluate({ key, timestampMs: 100 });
    await limiter.reset(key);

    const afterReset = await limiter.evaluate({ key, timestampMs: 200 });
    assert.equal(afterReset.allowed, true);
  });
});
