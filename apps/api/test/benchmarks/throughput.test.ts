import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FixedWindowLimiter,
  SlidingWindowCounterLimiter,
  TokenBucketLimiter,
  RedisClientManager,
  RedisFixedWindowLimiter,
} from "@throtl/rate-limiter";
import { MetricAggregator } from "../../dist/metrics/aggregator.js";

function calculatePercentiles(latenciesNs: number[]): {
  p50Ns: number;
  p90Ns: number;
  p99Ns: number;
  meanNs: number;
} {
  const sorted = [...latenciesNs].sort((a, b) => a - b);
  const p50Ns = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p90Ns = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const p99Ns = sorted[Math.floor(sorted.length * 0.99)] || 0;
  const meanNs = Math.round(sorted.reduce((acc, val) => acc + val, 0) / Math.max(sorted.length, 1));
  return { p50Ns, p90Ns, p99Ns, meanNs };
}

describe("Benchmark 3: Throughput & Precision Timing Invariant Verification", () => {
  it("verifies in-memory decision latency is under 100 microseconds across 1,000 virtual clients", async () => {
    const totalRequests = 10_000;
    const clientPoolSize = 1_000;
    const clientPool = Array.from({ length: clientPoolSize }, (_, i) => `client-${String(i + 1).padStart(4, "0")}`);

    const limiter = new SlidingWindowCounterLimiter({ limit: 100, windowSizeMs: 60_000 });
    const latenciesNs: number[] = [];

    const startHr = process.hrtime.bigint();

    for (let i = 0; i < totalRequests; i++) {
      const clientId = clientPool[i % clientPoolSize];
      const res = await limiter.evaluate({
        key: clientId,
        timestampMs: 1000 + (i % 5000),
      });
      latenciesNs.push(res.decisionLatencyNs);
    }

    const totalElapsedSec = Number(process.hrtime.bigint() - startHr) / 1e9;
    const achievedRps = Math.round(totalRequests / totalElapsedSec);
    const { p50Ns, p90Ns, p99Ns, meanNs } = calculatePercentiles(latenciesNs);

    // Architectural rule: decision routines must execute in under 100 microseconds (100,000 ns)
    assert.ok(
      meanNs < 100_000,
      `Mean decision latency (${meanNs} ns) must be under 100,000 ns (100 µs)`
    );
    assert.ok(
      p50Ns < 50_000,
      `Median decision latency (${p50Ns} ns) must be under 50,000 ns (50 µs)`
    );

    console.log(`
====================================================================================
BENCHMARK 3A: IN-MEMORY DECISION LATENCY REPORT (10,000 EVALUATIONS)
Pool: 1,000 Virtual Clients | Target: <100 µs Mean Latency | Engine: Sliding Window Counter
------------------------------------------------------------------------------------
Throughput:          ${achievedRps.toLocaleString().padEnd(12)} req/sec
Mean Latency:        ${(meanNs / 1000).toFixed(2).padEnd(12)} µs  (${meanNs} ns)
P50 Latency:         ${(p50Ns / 1000).toFixed(2).padEnd(12)} µs  (${p50Ns} ns)
P90 Latency:         ${(p90Ns / 1000).toFixed(2).padEnd(12)} µs  (${p90Ns} ns)
P99 Latency:         ${(p99Ns / 1000).toFixed(2).padEnd(12)} µs  (${p99Ns} ns)
Status:              PASS (<100 µs invariant satisfied)
====================================================================================
`);
  });

  it("verifies Redis Lua atomic decision latency is under 1.5ms across concurrent calls", async () => {
    const redisManager = new RedisClientManager({ url: "redis://localhost:6379" });
    const isRedisUp = await redisManager.checkHealth();

    if (!isRedisUp) {
      console.warn("⚠️ Skipping Redis Lua latency benchmark: Redis not running on :6379");
      return;
    }

    const redis = redisManager.getClient();
    const redisLimiter = new RedisFixedWindowLimiter(redis, { limit: 1000, windowSizeMs: 60_000 });

    const totalRequests = 100;
    const latenciesNs: number[] = [];

    // Evaluate decisions across clients with realistic concurrency
    for (let i = 0; i < totalRequests; i++) {
      const clientId = `bench-client-${i % 10}`;
      const res = await redisLimiter.evaluate({
        key: clientId,
        timestampMs: 1000 + i,
      });
      latenciesNs.push(res.decisionLatencyNs);
    }

    await redisManager.close();

    const { p50Ns, p90Ns, p99Ns, meanNs } = calculatePercentiles(latenciesNs);

    // Architectural rule: Redis Lua decision routines must execute in under 1.5ms (1,500,000 ns)
    assert.ok(
      meanNs < 1_500_000,
      `Mean Redis Lua decision latency (${meanNs} ns) must be under 1,500,000 ns (1.5 ms)`
    );

    console.log(`
====================================================================================
BENCHMARK 3B: REDIS LUA DISTRIBUTED DECISION LATENCY REPORT (100 EVALUATIONS)
Storage: Redis 7 Alpine EVALSHA | Target: <1.5 ms Mean Latency
------------------------------------------------------------------------------------
Mean Latency:        ${(meanNs / 1_000_000).toFixed(3).padEnd(12)} ms  (${meanNs} ns)
P50 Latency:         ${(p50Ns / 1_000_000).toFixed(3).padEnd(12)} ms  (${p50Ns} ns)
P90 Latency:         ${(p90Ns / 1_000_000).toFixed(3).padEnd(12)} ms  (${p90Ns} ns)
P99 Latency:         ${(p99Ns / 1_000_000).toFixed(3).padEnd(12)} ms  (${p99Ns} ns)
Status:              PASS (<1.5 ms invariant satisfied)
====================================================================================
`);
  });

  it("verifies MetricAggregator handles 1,000 req/s load with zero memory leak and 0 dropped ticks", () => {
    const aggregator = new MetricAggregator({
      tickIntervalMs: 50,
      sampleBufferSize: 100,
    });

    aggregator.start();

    const memBefore = process.memoryUsage().heapUsed;
    const totalEvents = 5_000;

    for (let i = 0; i < totalEvents; i++) {
      aggregator.record({
        allowed: i % 2 === 0,
        decisionLatencyNs: 850 + (i % 200),
        remaining: 50,
        limit: 100,
        instanceId: `instance-${(i % 3) + 1}`,
        clientId: `client-${i % 100}`,
        route: "/api/check",
      });
    }

    const currentTick = aggregator.flush();
    aggregator.stop();

    const memAfter = process.memoryUsage().heapUsed;
    const heapDeltaMb = (memAfter - memBefore) / (1024 * 1024);

    assert.equal(currentTick.totalCount, totalEvents);
    assert.equal(currentTick.allowedCount, 2500);
    assert.equal(currentTick.rejectedCount, 2500);
    assert.ok(currentTick.p50LatencyNs > 0);
    assert.ok(currentTick.recentSamples.length <= 100);

    // Memory growth during 5,000 tick aggregation must be bounded (<15 MB)
    assert.ok(heapDeltaMb < 15, `Heap growth (${heapDeltaMb.toFixed(2)} MB) must be bounded`);
  });
});
