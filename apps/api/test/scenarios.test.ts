import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  PRESET_SCENARIOS,
  getPresetScenario,
  createScenarioEngine,
} from "../dist/traffic/index.js";
import { CoordinatorGateway } from "../dist/coordinator/gateway.js";

describe("Preset Scenarios & Deterministic Seeds", () => {
  it("defines exact parameters for all 4 preset scenarios", () => {
    const login = PRESET_SCENARIOS["login-brute-force"];
    assert.equal(login.route, "/api/login");
    assert.equal(login.targetRps, 50);
    assert.equal(login.clientCount, 1);
    assert.equal(login.clientId, "client-attacker");

    const search = PRESET_SCENARIOS["search-spike"];
    assert.equal(search.route, "/api/search");
    assert.equal(search.targetRps, 500);
    assert.equal(search.clientCount, 500);
    assert.equal(search.pattern, "burst");

    const payment = PRESET_SCENARIOS["payment-retries"];
    assert.equal(payment.route, "/api/pay");
    assert.equal(payment.targetRps, 200);
    assert.equal(payment.clientCount, 200);
    assert.equal(payment.pattern, "burst");

    const upload = PRESET_SCENARIOS["file-uploads"];
    assert.equal(upload.route, "/api/upload");
    assert.equal(upload.targetRps, 50);
    assert.equal(upload.cost, 5);

    assert.throws(() => getPresetScenario("unknown" as any), /Unknown preset scenario/);
  });

  it("produces deterministic event stream with reproducible seeds", async () => {
    const runScenario = async (seed: number) => {
      const clients: string[] = [];
      const engine = createScenarioEngine("search-spike", {
        seed,
        durationMs: 150,
        tickIntervalMs: 5,
      });

      engine.on("request", (e) => clients.push(e.clientId));
      engine.start();

      await new Promise((resolve) => setTimeout(resolve, 160));
      return clients;
    };

    const run1 = await runScenario(4242);
    const run2 = await runScenario(4242);

    assert.ok(run1.length >= 10);
    assert.deepEqual(
      run1.slice(0, 10),
      run2.slice(0, 10),
      "Identical seeds must produce identical client sequences"
    );
  });
});

describe("Coordinator Simulator Endpoints & Traffic Routing", () => {
  const coordPort = 4080;
  const coordinator = new CoordinatorGateway({
    port: coordPort,
    spawnWorkers: true,
    instances: [
      { id: "instance-1", url: "http://localhost:4081" },
      { id: "instance-2", url: "http://localhost:4082" },
      { id: "instance-3", url: "http://localhost:4083" },
    ],
    mode: "per-instance",
    algorithm: "fixed-window",
    limit: 100,
    windowSizeMs: 60_000,
  });

  const baseUrl = `http://localhost:${coordPort}`;

  before(async () => {
    await coordinator.start();
  });

  after(async () => {
    await coordinator.stop();
  });

  it("exposes available preset scenarios via GET /api/simulator/scenarios", async () => {
    const res = await fetch(`${baseUrl}/api/simulator/scenarios`);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.ok(data.scenarios["login-brute-force"]);
    assert.ok(data.scenarios["search-spike"]);
    assert.ok(data.scenarios["payment-retries"]);
    assert.ok(data.scenarios["file-uploads"]);
  });

  it("triggers POST /api/simulator/start with login-brute-force and routes requests", async () => {
    const startRes = await fetch(`${baseUrl}/api/simulator/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenario: "login-brute-force",
        targetRps: 100,
      }),
    });
    const startData = await startRes.json();

    assert.equal(startRes.status, 200);
    assert.equal(startData.success, true);
    assert.equal(startData.running, true);
    assert.equal(startData.scenario, "login-brute-force");

    // Allow engine to emit requests and route to instances
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Check simulator status
    const statusRes = await fetch(`${baseUrl}/api/simulator/status`);
    const statusData = await statusRes.json();

    assert.equal(statusRes.status, 200);
    assert.equal(statusData.running, true);
    assert.equal(statusData.scenario, "login-brute-force");
    assert.ok(statusData.stats.totalEmitted > 0, "Requests should have been emitted");

    // Pause simulator
    const pauseRes = await fetch(`${baseUrl}/api/simulator/pause`, { method: "POST" });
    const pauseData = await pauseRes.json();
    assert.equal(pauseData.paused, true);

    const emittedBefore = statusData.stats.totalEmitted;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const statusPaused = await (await fetch(`${baseUrl}/api/simulator/status`)).json();
    assert.equal(statusPaused.paused, true);
    assert.equal(statusPaused.stats.totalEmitted, emittedBefore);

    // Resume simulator
    const resumeRes = await fetch(`${baseUrl}/api/simulator/resume`, { method: "POST" });
    const resumeData = await resumeRes.json();
    assert.equal(resumeData.paused, false);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Stop simulator
    const stopRes = await fetch(`${baseUrl}/api/simulator/stop`, { method: "POST" });
    const stopData = await stopRes.json();
    assert.equal(stopData.success, true);
    assert.equal(stopData.running, false);
    assert.ok(stopData.stats.totalEmitted > emittedBefore);
  });

  it("configures cluster settings via POST /api/simulator/configure", async () => {
    const confRes = await fetch(`${baseUrl}/api/simulator/configure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "shared",
        algorithm: "token-bucket",
        limit: 50,
      }),
    });
    const confData = await confRes.json();

    assert.equal(confRes.status, 200);
    assert.equal(confData.mode, "shared");
    assert.equal(confData.algorithm, "token-bucket");
    assert.equal(confData.limit, 50);

    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = await healthRes.json();
    assert.equal(healthData.mode, "shared");
    assert.equal(healthData.algorithm, "token-bucket");
  });
});
