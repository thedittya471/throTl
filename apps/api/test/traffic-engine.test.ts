import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TrafficEngine, type TrafficEvent } from "../dist/traffic/engine.js";

describe("TrafficEngine High-Throughput & Patterns", () => {
  it("initializes a virtual client pool of 1,000 clients (client-001 to client-1000)", () => {
    const engine = new TrafficEngine({ clientCount: 1000 });
    const pool = engine.getClientPool();

    assert.equal(pool.length, 1000);
    assert.equal(pool[0], "client-001");
    assert.equal(pool[999], "client-1000");
  });

  it("generates 1,000 events/second with low jitter (<5ms)", async () => {
    const events: { event: TrafficEvent; receivedAt: number }[] = [];
    const targetRps = 1000;
    const startMs = Date.now();

    const engine = new TrafficEngine({
      pattern: "steady",
      targetRps,
      clientCount: 1000,
      tickIntervalMs: 2,
    });

    engine.on("request", (event: TrafficEvent) => {
      events.push({ event, receivedAt: Date.now() });
    });

    engine.start();

    // Run for 300ms -> should generate ~300 requests
    await new Promise((resolve) => setTimeout(resolve, 300));
    engine.stop();

    assert.ok(
      events.length >= 250 && events.length <= 350,
      `Expected ~300 events, got ${events.length}`
    );

    // Verify low jitter: deviation between expected scheduled arrival and emission time
    let totalJitter = 0;
    const jitters: number[] = [];

    for (let i = 0; i < events.length; i++) {
      const scheduledMs = startMs + (i * 1000) / targetRps;
      const jitter = Math.abs(events[i].receivedAt - scheduledMs);
      totalJitter += jitter;
      jitters.push(jitter);
    }

    const avgJitter = totalJitter / events.length;
    jitters.sort((a, b) => a - b);
    const p95Jitter = jitters[Math.floor(jitters.length * 0.95)];

    assert.ok(avgJitter < 5, `Avg jitter ${avgJitter.toFixed(2)}ms exceeds 5ms threshold`);
    assert.ok(p95Jitter < 5, `P95 jitter ${p95Jitter.toFixed(2)}ms exceeds 5ms threshold`);
  });

  it("calculates rates correctly for burst, ramp-up, sawtooth, and window-boundary patterns", () => {
    const burstEngine = new TrafficEngine({
      pattern: "burst",
      targetRps: 100,
      burstMultiplier: 5,
      burstDurationMs: 2000,
      burstPeriodMs: 10000,
    });
    assert.equal(burstEngine.calculateCurrentRps(500), 500);
    assert.equal(burstEngine.calculateCurrentRps(3000), 100);

    const rampEngine = new TrafficEngine({
      pattern: "ramp-up",
      minRps: 10,
      maxRps: 500,
      rampDurationMs: 10000,
    });
    assert.equal(rampEngine.calculateCurrentRps(0), 10);
    assert.equal(rampEngine.calculateCurrentRps(5000), 255);
    assert.equal(rampEngine.calculateCurrentRps(10000), 500);

    const sawtoothEngine = new TrafficEngine({
      pattern: "sawtooth",
      minRps: 0,
      maxRps: 100,
      rampDurationMs: 10000,
    });
    assert.equal(sawtoothEngine.calculateCurrentRps(0), 0);
    assert.equal(sawtoothEngine.calculateCurrentRps(5000), 50);
    assert.equal(sawtoothEngine.calculateCurrentRps(10000), 0);

    const boundaryEngine = new TrafficEngine({
      pattern: "window-boundary",
      targetRps: 1000,
      minRps: 10,
      windowSizeMs: 60000,
    });
    assert.equal(boundaryEngine.calculateCurrentRps(59000), 1000);
    assert.equal(boundaryEngine.calculateCurrentRps(1000), 1000);
    assert.equal(boundaryEngine.calculateCurrentRps(30000), 10);
  });

  it("disproportionately targets heavy client in heavy-client pattern", async () => {
    const events: TrafficEvent[] = [];
    const engine = new TrafficEngine({
      pattern: "heavy-client",
      targetRps: 500,
      clientCount: 1000,
      seed: 42,
    });

    engine.on("request", (e) => events.push(e));
    engine.start();

    await new Promise((resolve) => setTimeout(resolve, 200));
    engine.stop();

    const heavyClientHits = events.filter((e) => e.clientId === "client-001").length;
    const heavyRatio = heavyClientHits / events.length;

    assert.ok(
      heavyRatio >= 0.7 && heavyRatio <= 0.9,
      `Heavy client ratio ${heavyRatio} should be ~0.8`
    );
  });

  it("supports start, pause, resume, reset and stop lifecycle", async () => {
    const engine = new TrafficEngine({ targetRps: 200 });
    let count = 0;
    engine.on("request", () => count++);

    engine.start();
    assert.equal(engine.isRunning(), true);
    assert.equal(engine.isPaused(), false);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const countBeforePause = count;
    assert.ok(countBeforePause > 0);

    engine.pause();
    assert.equal(engine.isPaused(), true);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(count, countBeforePause);

    engine.resume();
    assert.equal(engine.isPaused(), false);

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(count > countBeforePause);

    engine.stop();
    assert.equal(engine.isRunning(), false);

    engine.reset();
    assert.equal(engine.getStats().totalEmitted, 0);
  });

  it("produces deterministic client sequences given identical seeds", async () => {
    const runSequence = async (seed: number) => {
      const seq: string[] = [];
      const engine = new TrafficEngine({
        pattern: "steady",
        targetRps: 500,
        clientCount: 50,
        seed,
      });
      engine.on("request", (e) => seq.push(e.clientId));
      engine.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      engine.stop();
      return seq;
    };

    const seq1 = await runSequence(999);
    const seq2 = await runSequence(999);

    assert.ok(seq1.length > 10);
    assert.deepEqual(seq1.slice(0, 10), seq2.slice(0, 10));
  });
});
