import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { CoordinatorGateway } from "../dist/coordinator/gateway.js";

describe("CoordinatorGateway & Multi-Instance Cluster", () => {
  const coordPort = 4070;
  const coordinator = new CoordinatorGateway({
    port: coordPort,
    spawnWorkers: true,
    instances: [
      { id: "instance-1", url: "http://localhost:4071" },
      { id: "instance-2", url: "http://localhost:4072" },
      { id: "instance-3", url: "http://localhost:4073" },
    ],
    mode: "per-instance",
    algorithm: "fixed-window",
    limit: 3,
    windowSizeMs: 60_000,
  });

  const baseUrl = `http://localhost:${coordPort}`;

  before(async () => {
    await coordinator.start();
  });

  after(async () => {
    await coordinator.stop();
  });

  it("returns coordinator status and registered cluster instances", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.role, "coordinator");
    assert.equal(data.instances.length, 3);
  });

  it("dispatches requests in exact round-robin order across instances 1, 2, and 3", async () => {
    const instancesHit: string[] = [];

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/check`, {
        headers: { "x-client-id": `probe-${i}` },
      });
      instancesHit.push(res.headers.get("x-ratelimit-instance")!);
    }

    assert.deepEqual(instancesHit, ["instance-1", "instance-2", "instance-3"]);
  });

  it("demonstrates per-instance over-admission vs shared state coordination", async () => {
    // 1. Ensure per-instance mode and reset state
    await fetch(`${baseUrl}/api/simulator/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "per-instance" }),
    });

    await fetch(`${baseUrl}/api/simulator/algorithm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ algorithm: "fixed-window", limit: 3, windowSizeMs: 60_000 }),
    });

    await fetch(`${baseUrl}/api/simulator/reset`, { method: "POST" });

    // Under per-instance mode with limit 3:
    // Sending 9 requests round-robin across 3 instances sends 3 requests to each instance.
    // Since each instance has its own local memory limit of 3, ALL 9 requests are allowed!
    const perInstanceResults: boolean[] = [];
    for (let i = 0; i < 9; i++) {
      const res = await fetch(`${baseUrl}/api/check`, {
        headers: {
          "x-client-id": "client-cluster-test",
          "x-timestamp": "1000",
        },
      });
      perInstanceResults.push(res.status === 200);
    }

    const perInstanceAllowed = perInstanceResults.filter(Boolean).length;
    assert.equal(perInstanceAllowed, 9, "Per-instance mode should allow 3 reqs per instance = 9 total");

    // 2. Switch to shared mode (Redis-backed atomic Lua scripts)
    await fetch(`${baseUrl}/api/simulator/mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "shared" }),
    });

    await fetch(`${baseUrl}/api/simulator/reset`, { method: "POST" });

    // Under shared mode with limit 3:
    // All 3 instances share state in Redis.
    // Exactly 3 requests must be allowed, and 6 must be rejected (429)!
    const sharedResults: number[] = [];
    for (let i = 0; i < 9; i++) {
      const res = await fetch(`${baseUrl}/api/check`, {
        headers: {
          "x-client-id": "client-cluster-test",
          "x-timestamp": "1000",
        },
      });
      sharedResults.push(res.status);
    }

    const sharedAllowed = sharedResults.filter((s) => s === 200).length;
    const sharedBlocked = sharedResults.filter((s) => s === 429).length;

    assert.equal(sharedAllowed, 3, "Shared mode should strictly allow only 3 requests cluster-wide");
    assert.equal(sharedBlocked, 6, "Shared mode should reject 6 requests with 429");
  });
});
