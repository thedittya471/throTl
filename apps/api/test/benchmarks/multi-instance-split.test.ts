import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { CoordinatorGateway } from "../../dist/coordinator/gateway.js";
import { RedisClientManager } from "@throtl/rate-limiter";

describe("Benchmark 2: Cluster Coordination Invariant Verification", () => {
  const coordPort = 4085;
  const baseUrl = `http://localhost:${coordPort}`;
  let coordinator: CoordinatorGateway;
  let redisManager: RedisClientManager;

  before(async () => {
    redisManager = new RedisClientManager({ url: "redis://localhost:6379" });
    const isRedisUp = await redisManager.checkHealth();
    if (!isRedisUp) {
      console.warn("⚠️ Warning: Redis is not reachable at localhost:6379 for shared benchmark");
    }

    coordinator = new CoordinatorGateway({
      port: coordPort,
      spawnWorkers: true,
      instances: [
        { id: "instance-1", url: "http://localhost:4086" },
        { id: "instance-2", url: "http://localhost:4087" },
        { id: "instance-3", url: "http://localhost:4088" },
      ],
      mode: "per-instance",
      algorithm: "fixed-window",
      limit: 100,
      windowSizeMs: 60_000,
    });

    await coordinator.start();
  });

  after(async () => {
    await coordinator.stop();
    await redisManager.close();
  });

  it("proves Cluster Coordination Invariant: 300 reqs in per-instance mode admits 300 vs shared mode admits exactly 100", async () => {
    const totalRequests = 300;
    const limit = 100;

    // --- Phase 1: Per-Instance Mode (In-Memory) ---
    await fetch(`${baseUrl}/api/simulator/configure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "per-instance", algorithm: "fixed-window", limit }),
    });
    await fetch(`${baseUrl}/api/simulator/reset`, { method: "POST" });

    const perInstanceStatus: number[] = [];
    const perInstanceNodeCounts: Record<string, number> = {
      "instance-1": 0,
      "instance-2": 0,
      "instance-3": 0,
    };

    for (let i = 0; i < totalRequests; i++) {
      const res = await fetch(`${baseUrl}/api/check`, {
        headers: {
          "x-client-id": "client-cluster-bench",
          "x-timestamp": "1000",
        },
      });
      const inst = res.headers.get("x-ratelimit-instance") || "instance-unknown";
      if (perInstanceNodeCounts[inst] !== undefined) {
        perInstanceNodeCounts[inst]++;
      }
      perInstanceStatus.push(res.status);
    }

    const perInstanceAllowed = perInstanceStatus.filter((s) => s === 200).length;
    const perInstanceBlocked = perInstanceStatus.filter((s) => s === 429).length;

    // In per-instance mode, all 300 requests are admitted because each of the 3 instances received ~100 requests
    assert.equal(perInstanceAllowed, 300, "Per-instance mode admits all 300 requests across 3 isolated workers");
    assert.equal(perInstanceBlocked, 0, "Per-instance mode drops 0 requests due to lack of coordination");

    // --- Phase 2: Shared State Mode (Atomic Redis Lua) ---
    await fetch(`${baseUrl}/api/simulator/configure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "shared", algorithm: "fixed-window", limit }),
    });
    await fetch(`${baseUrl}/api/simulator/reset`, { method: "POST" });

    const sharedStatus: number[] = [];
    const sharedNodeCounts: Record<string, { allowed: number; blocked: number }> = {
      "instance-1": { allowed: 0, blocked: 0 },
      "instance-2": { allowed: 0, blocked: 0 },
      "instance-3": { allowed: 0, blocked: 0 },
    };

    for (let i = 0; i < totalRequests; i++) {
      const res = await fetch(`${baseUrl}/api/check`, {
        headers: {
          "x-client-id": "client-cluster-bench",
          "x-timestamp": "1000",
        },
      });
      const inst = res.headers.get("x-ratelimit-instance") || "instance-unknown";
      if (sharedNodeCounts[inst]) {
        if (res.status === 200) sharedNodeCounts[inst].allowed++;
        else sharedNodeCounts[inst].blocked++;
      }
      sharedStatus.push(res.status);
    }

    const sharedAllowed = sharedStatus.filter((s) => s === 200).length;
    const sharedBlocked = sharedStatus.filter((s) => s === 429).length;

    // In shared mode, Redis coordinates all 3 instances: exactly 100 allowed, 200 rejected!
    assert.equal(sharedAllowed, 100, "Shared mode strictly enforces cluster-wide limit of exactly 100 requests");
    assert.equal(sharedBlocked, 200, "Shared mode rejects 200 excess requests with HTTP 429");

    console.log(`
====================================================================================
BENCHMARK 2: CLUSTER COORDINATION INVARIANT VERIFICATION REPORT
Traffic: 300 requests distributed evenly across 3 cluster worker instances (Limit: 100 req/min)
------------------------------------------------------------------------------------
Coordination Mode   Allowed (200 OK)  Blocked (429)  Inst-1 Dist  Inst-2 Dist  Inst-3 Dist  Leak Status
------------------------------------------------------------------------------------
Per-Instance (Mem)  ${perInstanceAllowed.toString().padEnd(16)}  ${perInstanceBlocked.toString().padEnd(13)}  ${perInstanceNodeCounts["instance-1"].toString().padEnd(11)}  ${perInstanceNodeCounts["instance-2"].toString().padEnd(11)}  ${perInstanceNodeCounts["instance-3"].toString().padEnd(11)}  LEAK (300% budget)
Shared (Redis Lua)  ${sharedAllowed.toString().padEnd(16)}  ${sharedBlocked.toString().padEnd(13)}  ${(sharedNodeCounts["instance-1"].allowed + "/" + sharedNodeCounts["instance-1"].blocked).padEnd(11)}  ${(sharedNodeCounts["instance-2"].allowed + "/" + sharedNodeCounts["instance-2"].blocked).padEnd(11)}  ${(sharedNodeCounts["instance-3"].allowed + "/" + sharedNodeCounts["instance-3"].blocked).padEnd(11)}  PROTECTED (Exact 100)
====================================================================================
`);
  });
});
