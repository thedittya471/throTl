import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RingBuffer, MetricAggregator, type MetricRecord } from "../dist/metrics/index.js";

describe("RingBuffer", () => {
  it("enforces fixed capacity and overwrites oldest elements", () => {
    const buffer = new RingBuffer<number>(3);
    assert.equal(buffer.size(), 0);
    assert.equal(buffer.getCapacity(), 3);

    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    assert.equal(buffer.size(), 3);
    assert.deepEqual(buffer.toArray(), [1, 2, 3]);

    buffer.push(4);
    assert.equal(buffer.size(), 3);
    assert.deepEqual(buffer.toArray(), [2, 3, 4]);

    buffer.push(5);
    assert.deepEqual(buffer.toArray(), [3, 4, 5]);

    buffer.clear();
    assert.equal(buffer.size(), 0);
    assert.deepEqual(buffer.toArray(), []);
  });
});

describe("MetricAggregator", () => {
  it("aggregates metrics and calculates accurate percentiles and ratios", () => {
    const aggregator = new MetricAggregator({ sampleBufferSize: 100 });

    // Feed 100 results: 80 allowed, 20 rejected, latencies 1..100
    for (let i = 1; i <= 100; i++) {
      aggregator.record({
        allowed: i <= 80,
        decisionLatencyNs: i * 1000,
        remaining: 100 - i,
        instanceId: i % 2 === 0 ? "instance-1" : "instance-2",
        clientId: `client-${i}`,
        route: "/api/check",
        internalState: { tokens: 100 - i },
      });
    }

    const tick = aggregator.flush();

    assert.equal(tick.tickId, 1);
    assert.equal(tick.totalCount, 100);
    assert.equal(tick.allowedCount, 80);
    assert.equal(tick.rejectedCount, 20);
    assert.equal(tick.allowRatio, 0.8);
    assert.equal(tick.p50LatencyNs, 51000);
    assert.equal(tick.p90LatencyNs, 91000);
    assert.equal(tick.p99LatencyNs, 100000);
    assert.equal(tick.instanceDistribution["instance-1"].total, 50);
    assert.equal(tick.instanceDistribution["instance-2"].total, 50);
    assert.equal(tick.recentSamples.length, 100);
    assert.deepEqual(tick.internalStateSnapshot, { tokens: 0 });
  });

  it("handles high volume (10,000 mock results) with memory stability and zero leakage", () => {
    const aggregator = new MetricAggregator({ sampleBufferSize: 100 });

    const memBefore = process.memoryUsage().heapUsed;

    for (let i = 0; i < 10_000; i++) {
      aggregator.record({
        allowed: i % 3 !== 0,
        decisionLatencyNs: 500 + (i % 500),
        remaining: 50,
        instanceId: `instance-${(i % 3) + 1}`,
        clientId: `client-${i % 100}`,
        route: "/api/check",
      });

      if (i % 1000 === 0) {
        aggregator.flush();
      }
    }

    const finalTick = aggregator.flush();
    assert.ok(finalTick.recentSamples.length <= 100);

    // Garbage collection check: memory shouldn't balloon
    const memAfter = process.memoryUsage().heapUsed;
    const diffMb = (memAfter - memBefore) / (1024 * 1024);
    assert.ok(diffMb < 50, `Memory increased by ${diffMb.toFixed(2)} MB, expected < 50 MB`);
  });

  it("emits ticks on configured interval", async () => {
    const ticks: any[] = [];
    const aggregator = new MetricAggregator({ tickIntervalMs: 20 });

    aggregator.on("tick", (t) => ticks.push(t));
    aggregator.start();

    aggregator.record({ allowed: true, decisionLatencyNs: 1200, remaining: 10 });
    aggregator.record({ allowed: false, decisionLatencyNs: 800, remaining: 0 });

    await new Promise((resolve) => setTimeout(resolve, 65));
    aggregator.stop();

    assert.ok(ticks.length >= 2, `Expected at least 2 ticks, got ${ticks.length}`);
    assert.equal(ticks[0].tickId, 1);
    assert.equal(ticks[0].totalCount, 2);
  });
});
