import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SlidingLogLimiter } from "../dist/index.js";

describe("SlidingLogLimiter", () => {
  it("admits requests up to limit", async () => {
    const limiter = new SlidingLogLimiter({ limit: 5, windowSizeMs: 1000 });
    const key = "user-1";
    const timestamp = 1000;

    for (let i = 1; i <= 5; i++) {
      const result = await limiter.evaluate({ key, timestampMs: timestamp + i });

      assert.equal(result.allowed, true);
      assert.equal(result.remaining, 5 - i);
      assert.equal(result.internalState.currentCount, i);
    }
  });

  it("rejects requests exceeding limit with precise retry-after", async () => {
    const limiter = new SlidingLogLimiter({ limit: 2, windowSizeMs: 10_000 });
    const key = "user-1";

    await limiter.evaluate({ key, timestampMs: 1_000 });
    await limiter.evaluate({ key, timestampMs: 2_000 });

    const blocked = await limiter.evaluate({ key, timestampMs: 3_000 });

    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    // Oldest timestamp is 1_000, so reset is at 11_000. Current is 3_000 -> 8s retryAfter
    assert.equal(blocked.resetTimeMs, 11_000);
    assert.equal(blocked.retryAfterSec, 8);
  });

  it("frees capacity on exact rolling sliding window", async () => {
    const limiter = new SlidingLogLimiter({ limit: 2, windowSizeMs: 1_000 });
    const key = "user-1";

    await limiter.evaluate({ key, timestampMs: 100 });
    await limiter.evaluate({ key, timestampMs: 500 });

    const blocked = await limiter.evaluate({ key, timestampMs: 800 });
    assert.equal(blocked.allowed, false);

    // At 1101ms, the first request (100ms) has expired, but the second (500ms) is still active
    const admittedAfterFirstExpired = await limiter.evaluate({ key, timestampMs: 1101 });
    assert.equal(admittedAfterFirstExpired.allowed, true);
    assert.equal(admittedAfterFirstExpired.remaining, 0);

    // Still blocked until 500ms request expires at 1500ms
    const blockedAgain = await limiter.evaluate({ key, timestampMs: 1200 });
    assert.equal(blockedAgain.allowed, false);
  });

  it("prevents the boundary burst vulnerability completely", async () => {
    const limiter = new SlidingLogLimiter({ limit: 100, windowSizeMs: 60_000 });
    const key = "attacker";

    let admittedWindow1 = 0;
    for (let i = 0; i < 100; i++) {
      const res = await limiter.evaluate({ key, timestampMs: 59_900 });
      if (res.allowed) admittedWindow1++;
    }

    let admittedWindow2 = 0;
    for (let i = 0; i < 100; i++) {
      const res = await limiter.evaluate({ key, timestampMs: 60_100 });
      if (res.allowed) admittedWindow2++;
    }

    assert.equal(admittedWindow1, 100);
    // Boundary burst is prevented: window is 60_000ms, all 100 reqs from 59_900 are still in log at 60_100
    assert.equal(admittedWindow2, 0);
    assert.equal(admittedWindow1 + admittedWindow2, 100);
  });

  it("tracks state independently across different keys", async () => {
    const limiter = new SlidingLogLimiter({ limit: 1, windowSizeMs: 1000 });

    const user1 = await limiter.evaluate({ key: "u1", timestampMs: 100 });
    const user2 = await limiter.evaluate({ key: "u2", timestampMs: 100 });

    assert.equal(user1.allowed, true);
    assert.equal(user2.allowed, true);
  });

  it("clears state when reset is called", async () => {
    const limiter = new SlidingLogLimiter({ limit: 1, windowSizeMs: 1000 });
    const key = "user-1";

    await limiter.evaluate({ key, timestampMs: 100 });
    await limiter.reset(key);

    const afterReset = await limiter.evaluate({ key, timestampMs: 200 });
    assert.equal(afterReset.allowed, true);
  });
});
