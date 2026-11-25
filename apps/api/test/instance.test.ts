import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { InstanceServer } from "../dist/instance.js";

describe("InstanceServer", () => {
  const port = 4055;
  const instance = new InstanceServer({
    instanceId: "test-instance-1",
    port,
    mode: "per-instance",
    algorithm: "fixed-window",
    limit: 3,
    windowSizeMs: 10_000,
  });

  const baseUrl = `http://localhost:${port}`;

  before(async () => {
    await instance.start();
  });

  after(async () => {
    await instance.stop();
  });

  it("responds to /health with status and instance metadata", async () => {
    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.status, "ok");
    assert.equal(data.instanceId, "test-instance-1");
    assert.equal(data.mode, "per-instance");
    assert.equal(data.algorithm, "fixed-window");
    assert.equal(data.limit, 3);
  });

  it("attaches all standard rate-limit headers and returns 200 for allowed requests", async () => {
    const res = await fetch(`${baseUrl}/api/check`, {
      method: "POST",
      headers: {
        "x-client-id": "client-test-1",
        "x-timestamp": "1000",
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-ratelimit-limit"), "3");
    assert.equal(res.headers.get("x-ratelimit-remaining"), "2");
    assert.ok(res.headers.get("x-ratelimit-reset"));
    assert.equal(res.headers.get("x-ratelimit-algorithm"), "fixed-window");
    assert.equal(res.headers.get("x-ratelimit-instance"), "test-instance-1");
    assert.ok(res.headers.get("x-ratelimit-latency-ns"));
    assert.equal(res.headers.get("retry-after"), null);

    const body = await res.json();
    assert.equal(body.allowed, true);
    assert.equal(body.remaining, 2);
  });

  it("returns 429 and Retry-After when rate limit is exceeded", async () => {
    const clientId = "client-quota-exceeded";

    // Request 1, 2, 3 allowed (limit is 3)
    for (let i = 0; i < 3; i++) {
      await fetch(`${baseUrl}/api/check`, {
        headers: { "x-client-id": clientId, "x-timestamp": "2000" },
      });
    }

    // Request 4 must be 429 Too Many Requests
    const res = await fetch(`${baseUrl}/api/check`, {
      headers: { "x-client-id": clientId, "x-timestamp": "2000" },
    });

    assert.equal(res.status, 429);
    assert.equal(res.headers.get("x-ratelimit-limit"), "3");
    assert.equal(res.headers.get("x-ratelimit-remaining"), "0");
    assert.ok(res.headers.get("retry-after"));

    const body = await res.json();
    assert.equal(body.allowed, false);
    assert.equal(body.remaining, 0);
    assert.ok(body.retryAfterSec);
  });

  it("dynamically configures algorithm and mode via /api/configure", async () => {
    const res = await fetch(`${baseUrl}/api/configure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        algorithm: "token-bucket",
        limit: 50,
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.algorithm, "token-bucket");
    assert.equal(body.limit, 50);

    const checkRes = await fetch(`${baseUrl}/api/check`, {
      headers: { "x-client-id": "client-tb-test" },
    });
    assert.equal(checkRes.headers.get("x-ratelimit-algorithm"), "token-bucket");
    assert.equal(checkRes.headers.get("x-ratelimit-limit"), "50");
  });

  it("handles redis unavailability gracefully with 503 without crashing or hanging", async () => {
    const offlineInstance = new InstanceServer({
      instanceId: "test-offline-instance",
      port: 4056,
      mode: "shared",
      algorithm: "fixed-window",
      limit: 10,
      redisUrl: "redis://127.0.0.1:59999",
    });

    await offlineInstance.start();

    try {
      const res = await fetch("http://localhost:4056/api/check", {
        method: "POST",
        headers: { "x-client-id": "client-offline" },
      });

      assert.equal(res.status, 503);
      assert.equal(res.headers.get("x-ratelimit-instance"), "test-offline-instance");
      assert.equal(res.headers.get("retry-after"), "1");

      const body = await res.json();
      assert.equal(body.allowed, false);
      assert.equal(body.error, "Rate limiter backend storage unavailable");

      // Verify server remains online and responsive on /health
      const health = await fetch("http://localhost:4056/health");
      assert.equal(health.status, 200);
    } finally {
      await offlineInstance.stop();
    }
  });
});
