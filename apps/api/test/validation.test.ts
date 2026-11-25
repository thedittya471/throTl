import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  validateMode,
  validateAlgorithm,
  validateConfigure,
  validateStartSimulator,
  validateCompare,
  SUPPORTED_ALGORITHMS,
  SUPPORTED_MODES,
  SUPPORTED_PATTERNS,
  SUPPORTED_PRESETS,
  SUPPORTED_COMPARE_SCENARIOS,
  SUPPORTED_ROUTES,
  MAX_REPLAY_LIMIT,
  MAX_EFFECTIVE_BURST_RPS,
} from "../src/coordinator/validation.js";
import { CoordinatorGateway } from "../src/coordinator/gateway.js";

describe("Commit 10.3: Simulator Request Validation Policy", () => {
  describe("Unit: validateMode", () => {
    it("accepts supported modes", () => {
      for (const mode of SUPPORTED_MODES) {
        const result = validateMode(mode);
        assert.equal(result.ok, true);
        if (result.ok) {
          assert.equal(result.data, mode);
        }
      }
    });

    it("rejects invalid mode enums", () => {
      const invalid = ["distributed", "global", "local", "", 123, null, undefined, {}];
      for (const val of invalid) {
        const result = validateMode(val);
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.status, 400);
          assert.equal(result.field, "mode");
          assert.ok(result.error.includes("Invalid mode"));
        }
      }
    });
  });

  describe("Unit: validateAlgorithm", () => {
    it("accepts supported algorithms", () => {
      for (const algo of SUPPORTED_ALGORITHMS) {
        const result = validateAlgorithm(algo);
        assert.equal(result.ok, true);
        if (result.ok) {
          assert.equal(result.data, algo);
        }
      }
    });

    it("rejects invalid algorithm enums", () => {
      const invalid = ["token_bucket", "round-robin", "sliding", "", 42, null, undefined];
      for (const val of invalid) {
        const result = validateAlgorithm(val);
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.status, 400);
          assert.equal(result.field, "algorithm");
          assert.ok(result.error.includes("Invalid algorithm"));
        }
      }
    });
  });

  describe("Unit: validateConfigure", () => {
    it("accepts valid empty or partial configurations", () => {
      const resEmpty = validateConfigure({});
      assert.equal(resEmpty.ok, true);

      const resPartial = validateConfigure({
        mode: "shared",
        algorithm: "token-bucket",
        limit: 100,
        windowSizeMs: 60000,
        refillRatePerSec: 10,
        leakRatePerSec: 5,
      });
      assert.equal(resPartial.ok, true);
    });

    it("rejects invalid limit values", () => {
      const badLimits = [-1, 0, 100001, 1.5, "100", NaN, Infinity, null];
      for (const limit of badLimits) {
        const res = validateConfigure({ limit });
        assert.equal(res.ok, false, `Expected limit ${limit} to fail`);
        if (!res.ok) {
          assert.equal(res.status, 400);
          assert.equal(res.field, "limit");
        }
      }
    });

    it("rejects invalid windowSizeMs values", () => {
      const badWindows = [0, 99, 3600001, 50.5, "60000", null];
      for (const windowSizeMs of badWindows) {
        const res = validateConfigure({ windowSizeMs });
        assert.equal(res.ok, false, `Expected windowSizeMs ${windowSizeMs} to fail`);
        if (!res.ok) {
          assert.equal(res.status, 400);
          assert.equal(res.field, "windowSizeMs");
        }
      }
    });

    it("rejects invalid refillRatePerSec and leakRatePerSec", () => {
      const badRates = [-5, 0, 0.001, 100001, "10", NaN, null];
      for (const refillRatePerSec of badRates) {
        const res = validateConfigure({ refillRatePerSec });
        assert.equal(res.ok, false);
        if (!res.ok) {
          assert.equal(res.field, "refillRatePerSec");
        }
      }
      for (const leakRatePerSec of badRates) {
        const res = validateConfigure({ leakRatePerSec });
        assert.equal(res.ok, false);
        if (!res.ok) {
          assert.equal(res.field, "leakRatePerSec");
        }
      }
    });
  });

  describe("Unit: validateStartSimulator", () => {
    it("accepts valid defaults and presets", () => {
      for (const scenario of SUPPORTED_PRESETS) {
        const res = validateStartSimulator({ scenario });
        assert.equal(res.ok, true);
      }
      for (const pattern of SUPPORTED_PATTERNS) {
        const res = validateStartSimulator({ pattern });
        assert.equal(res.ok, true);
      }
      for (const route of SUPPORTED_ROUTES) {
        const res = validateStartSimulator({ route });
        assert.equal(res.ok, true);
      }
    });

    it("accepts boundary values within limits", () => {
      const res = validateStartSimulator({
        targetRps: 1000,
        burstMultiplier: 50,
        clientCount: 10000,
        cost: 1000,
        durationMs: 3600000,
        seed: 2147483647,
      });
      assert.equal(res.ok, true);
    });

    it("enforces maximum effective burst rate <= 50,000", () => {
      // 5,000 * 10 = 50,000 (allowed)
      const resOk = validateStartSimulator({
        targetRps: 5000,
        burstMultiplier: 10,
      });
      assert.equal(resOk.ok, true);

      // 5,001 * 10 = 50,010 (> 50,000, rejected)
      const resOver = validateStartSimulator({
        targetRps: 5001,
        burstMultiplier: 10,
      });
      assert.equal(resOver.ok, false);
      if (!resOver.ok) {
        assert.equal(resOver.status, 400);
        assert.equal(resOver.field, "burstMultiplier");
        assert.ok(resOver.error.includes("exceeds maximum allowed limit"));
      }
    });

    it("rejects invalid routes, non-integral clientCount, and negative durations", () => {
      assert.equal(validateStartSimulator({ route: "/invalid/route" }).ok, false);
      assert.equal(validateStartSimulator({ clientCount: 2.5 }).ok, false);
      assert.equal(validateStartSimulator({ clientCount: 0 }).ok, false);
      assert.equal(validateStartSimulator({ durationMs: -100 }).ok, false);
      assert.equal(validateStartSimulator({ cost: 0 }).ok, false);
      assert.equal(validateStartSimulator({ targetRps: 0 }).ok, false);
      assert.equal(validateStartSimulator({ targetRps: 10001 }).ok, false);
    });
  });

  describe("Unit: validateCompare", () => {
    it("accepts valid compare payloads and scenarios", () => {
      for (const scenario of SUPPORTED_COMPARE_SCENARIOS) {
        const res = validateCompare({
          algoA: "fixed-window",
          algoB: "sliding-window-counter",
          scenario,
          limit: 100,
          windowSizeMs: 60000,
        });
        assert.equal(res.ok, true);
      }
    });

    it("enforces maximum replay size limit <= 5,000", () => {
      const resOk = validateCompare({ limit: MAX_REPLAY_LIMIT });
      assert.equal(resOk.ok, true);

      const resOver = validateCompare({ limit: MAX_REPLAY_LIMIT + 1 });
      assert.equal(resOver.ok, false);
      if (!resOver.ok) {
        assert.equal(resOver.status, 400);
        assert.equal(resOver.field, "limit");
        assert.ok(resOver.error.includes(`between 1 and ${MAX_REPLAY_LIMIT}`));
      }
    });

    it("rejects unknown comparison scenario or algorithms", () => {
      assert.equal(validateCompare({ algoA: "unknown" as any }).ok, false);
      assert.equal(validateCompare({ algoB: "unknown" as any }).ok, false);
      assert.equal(validateCompare({ scenario: "non-existent" as any }).ok, false);
    });
  });

  describe("Integration: Coordinator Gateway Validation Endpoints", () => {
    const port = 4085;
    const baseUrl = `http://127.0.0.1:${port}`;
    let coordinator: CoordinatorGateway;

    before(async () => {
      coordinator = new CoordinatorGateway({
        port,
        host: "127.0.0.1",
        spawnWorkers: false,
        instances: [],
        mode: "per-instance",
        algorithm: "fixed-window",
        limit: 100,
        windowSizeMs: 60000,
      });
      await coordinator.start();
    });

    after(async () => {
      await coordinator.stop();
    });

    it("POST /api/simulator/mode rejects invalid modes with 400 and preserves mode", async () => {
      const res = await fetch(`${baseUrl}/api/simulator/mode`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "invalid-mode" }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error, "Validation Error");
      assert.equal(data.field, "mode");

      // Verify health check still shows per-instance mode
      const health = await (await fetch(`${baseUrl}/health`)).json();
      assert.equal(health.mode, "per-instance");
    });

    it("POST /api/simulator/algorithm rejects invalid algorithm with 400", async () => {
      const res = await fetch(`${baseUrl}/api/simulator/algorithm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ algorithm: "bad-algo" }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error, "Validation Error");
      assert.equal(data.field, "algorithm");

      const health = await (await fetch(`${baseUrl}/health`)).json();
      assert.equal(health.algorithm, "fixed-window");
    });

    it("POST /api/simulator/configure rejects invalid parameters with 400", async () => {
      const res = await fetch(`${baseUrl}/api/simulator/configure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: -50 }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error, "Validation Error");
      assert.equal(data.field, "limit");
    });

    it("POST /api/simulator/compare rejects replay limit exceeding 5,000", async () => {
      const res = await fetch(`${baseUrl}/api/simulator/compare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 5001 }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.error, "Validation Error");
      assert.equal(data.field, "limit");
    });

    it("POST /api/simulator/start rejects invalid requests without stopping active run", async () => {
      // 1. Start a valid simulation run
      const validStartRes = await fetch(`${baseUrl}/api/simulator/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetRps: 10,
          durationMs: 30000,
          pattern: "steady",
        }),
      });
      assert.equal(validStartRes.status, 200);
      const startData = await validStartRes.json();
      assert.equal(startData.running, true);

      // Verify simulator status is running
      const statusRes1 = await fetch(`${baseUrl}/api/simulator/status`);
      const status1 = await statusRes1.json();
      assert.equal(status1.running, true);

      // 2. Submit an invalid start request (effective burst rate > 50,000)
      const invalidStartRes = await fetch(`${baseUrl}/api/simulator/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetRps: 10000,
          burstMultiplier: 10, // 100,000 > 50,000
        }),
      });
      assert.equal(invalidStartRes.status, 400);
      const errData = await invalidStartRes.json();
      assert.equal(errData.error, "Validation Error");
      assert.equal(errData.field, "burstMultiplier");

      // 3. Verify that the previous valid simulation run is STILL ACTIVE!
      const statusRes2 = await fetch(`${baseUrl}/api/simulator/status`);
      const status2 = await statusRes2.json();
      assert.equal(status2.running, true, "Active simulator run must NOT be stopped or mutated on invalid request");

      // 4. Submit an invalid route request
      const invalidRouteRes = await fetch(`${baseUrl}/api/simulator/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          route: "/api/unknown-service",
        }),
      });
      assert.equal(invalidRouteRes.status, 400);

      // Verify still running
      const statusRes3 = await fetch(`${baseUrl}/api/simulator/status`);
      const status3 = await statusRes3.json();
      assert.equal(status3.running, true);

      // Clean up: stop the running engine
      await fetch(`${baseUrl}/api/simulator/stop`, { method: "POST" });
      const finalStatus = await (await fetch(`${baseUrl}/api/simulator/status`)).json();
      assert.equal(finalStatus.running, false);
    });
  });
});
