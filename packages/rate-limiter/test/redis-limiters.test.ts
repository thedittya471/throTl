import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  RedisClientManager,
  RedisFixedWindowLimiter,
  RedisSlidingLogLimiter,
  RedisSlidingWindowCounterLimiter,
  RedisTokenBucketLimiter,
  RedisLeakyBucketLimiter,
} from "../dist/index.js";

describe("Redis Distributed Limiters (Atomic Lua Scripts)", () => {
  const manager = new RedisClientManager({
    url: process.env.REDIS_URL || "redis://localhost:6379",
  });
  const redis = manager.getClient();

  after(async () => {
    await manager.close();
  });

  describe("RedisFixedWindowLimiter", () => {
    const limiter = new RedisFixedWindowLimiter(redis, {
      limit: 10,
      windowSizeMs: 1000,
      keyPrefix: "test:rfw:",
    });

    beforeEach(async () => {
      await limiter.reset();
    });

    it("admits requests up to limit and blocks excess", async () => {
      const key = "user-1";
      for (let i = 1; i <= 10; i++) {
        const res = await limiter.evaluate({ key, timestampMs: 100 });
        assert.equal(res.allowed, true);
        assert.equal(res.remaining, 10 - i);
      }

      const blocked = await limiter.evaluate({ key, timestampMs: 100 });
      assert.equal(blocked.allowed, false);
      assert.equal(blocked.remaining, 0);
    });

    it("atomically handles 100 concurrent promises with zero race condition", async () => {
      const key = "concurrent-fw";
      const requests = Array.from({ length: 100 }, () =>
        limiter.evaluate({ key, timestampMs: 500 })
      );

      const results = await Promise.all(requests);
      const allowed = results.filter((r) => r.allowed).length;
      const rejected = results.filter((r) => !r.allowed).length;

      assert.equal(allowed, 10);
      assert.equal(rejected, 90);
    });
  });

  describe("RedisSlidingLogLimiter", () => {
    const limiter = new RedisSlidingLogLimiter(redis, {
      limit: 10,
      windowSizeMs: 1000,
      keyPrefix: "test:rsl:",
    });

    beforeEach(async () => {
      await limiter.reset();
    });

    it("prevents boundary burst attacks", async () => {
      const key = "attacker";
      for (let i = 0; i < 10; i++) {
        const res = await limiter.evaluate({ key, timestampMs: 990 });
        assert.equal(res.allowed, true);
      }

      // Across window boundary at 1010ms, previous 10 are still inside the 1000ms window
      const resAtBoundary = await limiter.evaluate({ key, timestampMs: 1010 });
      assert.equal(resAtBoundary.allowed, false);
    });

    it("atomically handles 100 concurrent promises", async () => {
      const key = "concurrent-sl";
      const requests = Array.from({ length: 100 }, () =>
        limiter.evaluate({ key, timestampMs: 1000 })
      );

      const results = await Promise.all(requests);
      const allowed = results.filter((r) => r.allowed).length;
      const rejected = results.filter((r) => !r.allowed).length;

      assert.equal(allowed, 10);
      assert.equal(rejected, 90);
    });
  });

  describe("RedisSlidingWindowCounterLimiter", () => {
    const limiter = new RedisSlidingWindowCounterLimiter(redis, {
      limit: 10,
      windowSizeMs: 1000,
      keyPrefix: "test:rswc:",
    });

    beforeEach(async () => {
      await limiter.reset();
    });

    it("atomically handles 100 concurrent requests", async () => {
      const key = "concurrent-swc";
      const requests = Array.from({ length: 100 }, () =>
        limiter.evaluate({ key, timestampMs: 200 })
      );

      const results = await Promise.all(requests);
      const allowed = results.filter((r) => r.allowed).length;
      const rejected = results.filter((r) => !r.allowed).length;

      assert.equal(allowed, 10);
      assert.equal(rejected, 90);
    });
  });

  describe("RedisTokenBucketLimiter", () => {
    const limiter = new RedisTokenBucketLimiter(redis, {
      capacity: 10,
      refillRatePerSec: 5,
      keyPrefix: "test:rtb:",
    });

    beforeEach(async () => {
      await limiter.reset();
    });

    it("atomically handles concurrent burst up to capacity", async () => {
      const key = "concurrent-tb";
      const requests = Array.from({ length: 50 }, () =>
        limiter.evaluate({ key, timestampMs: 1000 })
      );

      const results = await Promise.all(requests);
      const allowed = results.filter((r) => r.allowed).length;
      const rejected = results.filter((r) => !r.allowed).length;

      assert.equal(allowed, 10);
      assert.equal(rejected, 40);
    });

    it("refills tokens over time", async () => {
      const key = "refill-tb";
      for (let i = 0; i < 10; i++) {
        await limiter.evaluate({ key, timestampMs: 0 });
      }

      // At t = 1000ms, 5 tokens refilled
      const res = await limiter.evaluate({ key, timestampMs: 1000 });
      assert.equal(res.allowed, true);
    });
  });

  describe("RedisLeakyBucketLimiter", () => {
    const limiter = new RedisLeakyBucketLimiter(redis, {
      capacity: 10,
      leakRatePerSec: 5,
      keyPrefix: "test:rlb:",
    });

    beforeEach(async () => {
      await limiter.reset();
    });

    it("atomically handles concurrent requests up to capacity", async () => {
      const key = "concurrent-lb";
      const requests = Array.from({ length: 50 }, () =>
        limiter.evaluate({ key, timestampMs: 1000 })
      );

      const results = await Promise.all(requests);
      const allowed = results.filter((r) => r.allowed).length;
      const rejected = results.filter((r) => !r.allowed).length;

      assert.equal(allowed, 10);
      assert.equal(rejected, 40);
    });

    it("leaks water creating new capacity over time", async () => {
      const key = "leak-lb";
      for (let i = 0; i < 10; i++) {
        await limiter.evaluate({ key, timestampMs: 0 });
      }

      // At t = 1000ms, 5 units leaked
      const res = await limiter.evaluate({ key, timestampMs: 1000 });
      assert.equal(res.allowed, true);
    });
  });
});
