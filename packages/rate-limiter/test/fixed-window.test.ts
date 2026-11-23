import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FixedWindowLimiter } from "../dist/index.js";

describe("FixedWindowLimiter", () => {
  it("admits requests within window limit", async () => {
    const limiter = new FixedWindowLimiter({ limit: 5, windowSizeMs: 1000 });
    const key = "user-1";
    const timestamp = 1000;

    for (let i = 1; i <= 5; i++) {
      const result = await limiter.evaluate({ key, timestampMs: timestamp });

      assert.equal(result.allowed, true);
      assert.equal(result.remaining, 5 - i);
      assert.equal(result.limit, 5);
      assert.equal(result.internalState.count, i);
      assert.equal(result.retryAfterSec, undefined);
    }
  });

  it("rejects requests exceeding limit with proper retry-after", async () => {
    const limiter = new FixedWindowLimiter({ limit: 3, windowSizeMs: 10_000 });
    const key = "user-1";
    const timestamp = 2_000;

    for (let i = 0; i < 3; i++) {
      await limiter.evaluate({ key, timestampMs: timestamp });
    }

    const blockedResult = await limiter.evaluate({ key, timestampMs: timestamp });

    assert.equal(blockedResult.allowed, false);
    assert.equal(blockedResult.remaining, 0);
    assert.equal(blockedResult.resetTimeMs, 10_000);
    assert.equal(blockedResult.retryAfterSec, 8);
  });

  it("resets budget when advancing to next window", async () => {
    const limiter = new FixedWindowLimiter({ limit: 2, windowSizeMs: 1_000 });
    const key = "user-1";

    const res1 = await limiter.evaluate({ key, timestampMs: 500 });
    const res2 = await limiter.evaluate({ key, timestampMs: 800 });
    const res3 = await limiter.evaluate({ key, timestampMs: 900 });

    assert.equal(res1.allowed, true);
    assert.equal(res2.allowed, true);
    assert.equal(res3.allowed, false);

    const resNextWindow = await limiter.evaluate({ key, timestampMs: 1001 });

    assert.equal(resNextWindow.allowed, true);
    assert.equal(resNextWindow.remaining, 1);
  });

  it("demonstrates the boundary burst vulnerability", async () => {
    const limiter = new FixedWindowLimiter({ limit: 100, windowSizeMs: 60_000 });
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
    assert.equal(admittedWindow2, 100);
    assert.equal(admittedWindow1 + admittedWindow2, 200);
  });

  it("tracks state independently across different keys", async () => {
    const limiter = new FixedWindowLimiter({ limit: 2, windowSizeMs: 1000 });

    const clientA1 = await limiter.evaluate({ key: "client-a", timestampMs: 100 });
    const clientB1 = await limiter.evaluate({ key: "client-b", timestampMs: 100 });

    assert.equal(clientA1.allowed, true);
    assert.equal(clientB1.allowed, true);

    const stateA = await limiter.getState("client-a");
    assert.equal(stateA.count, 1);
  });

  it("clears state when reset is called", async () => {
    const limiter = new FixedWindowLimiter({ limit: 1, windowSizeMs: 1000 });
    const key = "user-1";

    await limiter.evaluate({ key, timestampMs: 100 });
    await limiter.reset(key);

    const afterReset = await limiter.evaluate({ key, timestampMs: 200 });
    assert.equal(afterReset.allowed, true);
  });
});
