import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  FixedWindowLimiter,
  SlidingWindowCounterLimiter,
  SlidingLogLimiter,
} from "@throtl/rate-limiter";
import { CoordinatorGateway } from "../../dist/coordinator/gateway.js";

describe("Benchmark 1: Boundary Burst Invariant Verification", () => {
  const coordPort = 4081;
  let coordinator: CoordinatorGateway;
  const baseUrl = `http://localhost:${coordPort}`;

  before(async () => {
    coordinator = new CoordinatorGateway({
      port: coordPort,
      spawnWorkers: false,
    });
    await coordinator.start();
  });

  after(async () => {
    await coordinator.stop();
  });

  it("proves the Boundary Burst Invariant: Fixed Window admits ~200 vs Sliding Window Counter admits ~100", async () => {
    const limit = 100;
    const windowSizeMs = 60_000;
    const key = "client-boundary-attacker";

    const fixed = new FixedWindowLimiter({ limit, windowSizeMs });
    const slidingCounter = new SlidingWindowCounterLimiter({ limit, windowSizeMs });
    const slidingLog = new SlidingLogLimiter({ limit, windowSizeMs });

    // Phase 1: 100 requests arrive at t = 59,900ms (100ms before Window 1 expires)
    const tWindow1 = 59_900;
    let fixedPhase1 = 0;
    let counterPhase1 = 0;
    let logPhase1 = 0;

    for (let i = 0; i < limit; i++) {
      if ((await fixed.evaluate({ key, timestampMs: tWindow1 })).allowed) fixedPhase1++;
      if ((await slidingCounter.evaluate({ key, timestampMs: tWindow1 })).allowed) counterPhase1++;
      if ((await slidingLog.evaluate({ key, timestampMs: tWindow1 })).allowed) logPhase1++;
    }

    assert.equal(fixedPhase1, 100, "Fixed Window should admit 100 requests in Window 1");
    assert.equal(counterPhase1, 100, "Sliding Window Counter should admit 100 requests in Window 1");
    assert.equal(logPhase1, 100, "Sliding Log should admit 100 requests in Window 1");

    // Phase 2: 100 requests arrive at t = 60,100ms (100ms into Window 2, only 200ms later!)
    const tWindow2 = 60_100;
    let fixedPhase2 = 0;
    let counterPhase2 = 0;
    let logPhase2 = 0;

    for (let i = 0; i < limit; i++) {
      if ((await fixed.evaluate({ key, timestampMs: tWindow2 })).allowed) fixedPhase2++;
      if ((await slidingCounter.evaluate({ key, timestampMs: tWindow2 })).allowed) counterPhase2++;
      if ((await slidingLog.evaluate({ key, timestampMs: tWindow2 })).allowed) logPhase2++;
    }

    const fixedTotal = fixedPhase1 + fixedPhase2;
    const counterTotal = counterPhase1 + counterPhase2;
    const logTotal = logPhase1 + logPhase2;

    // Fixed Window boundary vulnerability allows exactly 200 requests within 200ms
    assert.equal(fixedPhase2, 100, "Fixed Window resets at window boundary and admits 100 more requests");
    assert.equal(fixedTotal, 200, "Fixed Window admits 200 requests (100% over-admission)");

    // Sliding Window Counter protects boundary: rejects all requests in Phase 2
    assert.equal(counterPhase2, 0, "Sliding Window Counter blocks all requests across boundary");
    assert.equal(counterTotal, 100, "Sliding Window Counter strictly caps total admitted requests at 100");

    // Sliding Log protects boundary: rejects all requests in Phase 2
    assert.equal(logPhase2, 0, "Sliding Log blocks all requests across boundary");
    assert.equal(logTotal, 100, "Sliding Log strictly caps total admitted requests at 100");

    // Output formatted verification table
    console.log(`
====================================================================================
BENCHMARK 1: BOUNDARY BURST INVARIANT VERIFICATION REPORT
Traffic: 200 requests across boundary (100 @ t=59.9s, 100 @ t=60.1s | Window=60s, Limit=100)
------------------------------------------------------------------------------------
Algorithm               Phase 1 (t=59.9s)  Phase 2 (t=60.1s)  Total Admitted  Boundary Leak?
------------------------------------------------------------------------------------
Fixed Window            ${fixedPhase1.toString().padEnd(17)}  ${fixedPhase2.toString().padEnd(17)}  ${fixedTotal.toString().padEnd(14)}  YES (+100 reqs / 200%)
Sliding Window Counter  ${counterPhase1.toString().padEnd(17)}  ${counterPhase2.toString().padEnd(17)}  ${counterTotal.toString().padEnd(14)}  NO  (0 reqs / 100%)
Sliding Log             ${logPhase1.toString().padEnd(17)}  ${logPhase2.toString().padEnd(17)}  ${logTotal.toString().padEnd(14)}  NO  (0 reqs / 100%)
====================================================================================
`);
  });

  it("verifies boundary burst divergence over Coordinator Replay API", async () => {
    const res = await fetch(`${baseUrl}/api/simulator/compare`, {
      method: "POST",
      headers: { "content-Type": "application/json" },
      body: JSON.stringify({
        algoA: "fixed-window",
        algoB: "sliding-window-counter",
        scenario: "window-boundary",
        limit: 100,
        windowSizeMs: 60_000,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.success, true);
    assert.equal(data.algoA.allowed, 200);
    assert.equal(data.algoB.allowed, 100);
    assert.equal(data.divergence, 100);
    assert.equal(data.boundaryLeakDetected, true);
  });
});
