import express, { type Request, type Response, type Express } from "express";
import { Server } from "node:http";
import {
  type IRateLimiter,
  FixedWindowLimiter,
  SlidingLogLimiter,
  SlidingWindowCounterLimiter,
  TokenBucketLimiter,
  LeakyBucketLimiter,
} from "@throtl/rate-limiter";
import { InstanceServer, type LimiterMode, type AlgorithmType } from "../instance.js";
import {
  TrafficEngine,
  type TrafficEngineConfig,
  type TrafficEvent,
  type ScenarioName,
  PRESET_SCENARIOS,
  getPresetScenario,
} from "../traffic/index.js";
import { MetricAggregator } from "../metrics/index.js";
import { MetricsStreamManager } from "./stream.js";
import {
  validateMode,
  validateAlgorithm,
  validateConfigure,
  validateStartSimulator,
  validateCompare,
} from "./validation.js";

export interface InstanceTarget {
  id: string;
  url: string;
}

export interface CoordinatorConfig {
  host?: string;
  port?: number;
  instances?: InstanceTarget[];
  spawnWorkers?: boolean;
  mode?: LimiterMode;
  algorithm?: AlgorithmType;
  limit?: number;
  windowSizeMs?: number;
  refillRatePerSec?: number;
  leakRatePerSec?: number;
  tickIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

function createCompareLimiter(
  algorithm: AlgorithmType,
  config: { limit: number; windowSizeMs: number; refillRatePerSec: number; leakRatePerSec: number }
): IRateLimiter {
  switch (algorithm) {
    case "fixed-window":
      return new FixedWindowLimiter({ limit: config.limit, windowSizeMs: config.windowSizeMs });
    case "sliding-log":
      return new SlidingLogLimiter({ limit: config.limit, windowSizeMs: config.windowSizeMs });
    case "sliding-window-counter":
      return new SlidingWindowCounterLimiter({ limit: config.limit, windowSizeMs: config.windowSizeMs });
    case "token-bucket":
      return new TokenBucketLimiter({ capacity: config.limit, refillRatePerSec: config.refillRatePerSec });
    case "leaky-bucket":
      return new LeakyBucketLimiter({ capacity: config.limit, leakRatePerSec: config.leakRatePerSec });
    default:
      return new FixedWindowLimiter({ limit: config.limit, windowSizeMs: config.windowSizeMs });
  }
}

export class CoordinatorGateway {
  readonly host: string;
  readonly port: number;
  instances: InstanceTarget[];
  mode: LimiterMode;
  algorithm: AlgorithmType;
  limit: number;
  windowSizeMs: number;
  refillRatePerSec: number;
  leakRatePerSec: number;
  readonly aggregator: MetricAggregator;
  readonly metricsStream: MetricsStreamManager;

  private app: Express;
  private server?: Server;
  private spawnedWorkers: InstanceServer[] = [];
  private rrIndex: number = 0;
  private trafficEngine: TrafficEngine | null = null;
  private currentScenario: string | null = null;

  constructor(config: CoordinatorConfig = {}) {
    this.host = config.host || process.env.HOST || "127.0.0.1";
    this.port = config.port || Number(process.env.COORDINATOR_PORT || process.env.PORT) || 4000;
    this.mode = config.mode || "per-instance";
    this.algorithm = config.algorithm || "fixed-window";
    this.limit = config.limit || 100;
    this.windowSizeMs = config.windowSizeMs || 60_000;
    this.refillRatePerSec = config.refillRatePerSec || 10;
    this.leakRatePerSec = config.leakRatePerSec || 10;

    this.aggregator = new MetricAggregator({
      tickIntervalMs: config.tickIntervalMs ?? 100,
      sampleBufferSize: 100,
    });
    this.metricsStream = new MetricsStreamManager(this.aggregator, {
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 15_000,
    });

    if (config.instances && config.instances.length > 0) {
      this.instances = config.instances;
    } else {
      const defaultHost = this.host;
      const port1 = Number(process.env.INSTANCE_1_PORT) || 4001;
      const port2 = Number(process.env.INSTANCE_2_PORT) || 4002;
      const port3 = Number(process.env.INSTANCE_3_PORT) || 4003;
      this.instances = [
        { id: "instance-1", url: `http://${defaultHost}:${port1}` },
        { id: "instance-2", url: `http://${defaultHost}:${port2}` },
        { id: "instance-3", url: `http://${defaultHost}:${port3}` },
      ];
    }

    if (config.spawnWorkers) {
      this.spawnedWorkers = this.instances.map((target) => {
        const url = new URL(target.url);
        return new InstanceServer({
          instanceId: target.id,
          host: url.hostname || this.host,
          port: Number(url.port),
          mode: this.mode,
          algorithm: this.algorithm,
          limit: this.limit,
          windowSizeMs: this.windowSizeMs,
          refillRatePerSec: this.refillRatePerSec,
          leakRatePerSec: this.leakRatePerSec,
        });
      });
    }

    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use(express.json());

    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({
        status: "ok",
        role: "coordinator",
        mode: this.mode,
        algorithm: this.algorithm,
        instances: this.instances,
      });
    });

    this.app.get("/api/stream/metrics", (req: Request, res: Response) => {
      this.metricsStream.handleClient(req, res);
    });

    this.app.get("/api/cluster/status", async (_req: Request, res: Response) => {
      const statuses = await Promise.all(
        this.instances.map(async (inst) => {
          try {
            const resp = await fetch(`${inst.url}/health`, {
              signal: AbortSignal.timeout(2000),
            });
            const data = await resp.json();
            return { id: inst.id, url: inst.url, alive: true, data };
          } catch (err: any) {
            return { id: inst.id, url: inst.url, alive: false, error: err.message };
          }
        })
      );

      res.json({
        mode: this.mode,
        algorithm: this.algorithm,
        limit: this.limit,
        instances: statuses,
      });
    });

    this.app.post("/api/simulator/mode", async (req: Request, res: Response) => {
      const validation = validateMode(req.body?.mode);
      if (!validation.ok) {
        res.status(400).json({ error: "Validation Error", message: validation.error, field: validation.field });
        return;
      }

      this.mode = validation.data;

      await this.broadcastConfig({ mode: this.mode });

      res.json({
        success: true,
        mode: this.mode,
      });
    });

    this.app.post("/api/simulator/algorithm", async (req: Request, res: Response) => {
      if (!req.body || req.body.algorithm === undefined) {
        res.status(400).json({ error: "Validation Error", message: "algorithm is required", field: "algorithm" });
        return;
      }
      const validation = validateConfigure(req.body);
      if (!validation.ok) {
        res.status(400).json({ error: "Validation Error", message: validation.error, field: validation.field });
        return;
      }

      if (validation.data.algorithm) this.algorithm = validation.data.algorithm;
      if (validation.data.limit !== undefined) this.limit = validation.data.limit;
      if (validation.data.windowSizeMs !== undefined) this.windowSizeMs = validation.data.windowSizeMs;
      if (validation.data.refillRatePerSec !== undefined) this.refillRatePerSec = validation.data.refillRatePerSec;
      if (validation.data.leakRatePerSec !== undefined) this.leakRatePerSec = validation.data.leakRatePerSec;

      await this.broadcastConfig({
        algorithm: this.algorithm,
        limit: this.limit,
        windowSizeMs: this.windowSizeMs,
        refillRatePerSec: this.refillRatePerSec,
        leakRatePerSec: this.leakRatePerSec,
      });

      res.json({
        success: true,
        algorithm: this.algorithm,
        limit: this.limit,
      });
    });

    this.app.post("/api/simulator/reset", async (_req: Request, res: Response) => {
      this.trafficEngine?.reset();
      const wasRunning = this.aggregator.isRunning();
      this.aggregator.reset();
      if (wasRunning) {
        this.aggregator.start();
      }

      await Promise.all(
        this.instances.map(async (inst) => {
          try {
            await fetch(`${inst.url}/api/reset`, {
              method: "POST",
              signal: AbortSignal.timeout(2000),
            });
          } catch {
            // Ignore offline instances on reset
          }
        })
      );

      res.json({
        success: true,
        reset: true,
        stats: this.trafficEngine?.getStats() ?? null,
      });
    });

    this.app.get("/api/simulator/scenarios", (_req: Request, res: Response) => {
      res.json({ scenarios: PRESET_SCENARIOS });
    });

    this.app.get("/api/simulator/status", (_req: Request, res: Response) => {
      res.json({
        running: this.trafficEngine?.isRunning() ?? false,
        paused: this.trafficEngine?.isPaused() ?? false,
        scenario: this.currentScenario,
        stats: this.trafficEngine?.getStats() ?? null,
        algorithm: this.algorithm,
        mode: this.mode,
        limit: this.limit,
        windowSizeMs: this.windowSizeMs,
      });
    });

    this.app.post("/api/simulator/compare", async (req: Request, res: Response) => {
      const validation = validateCompare(req.body);
      if (!validation.ok) {
        res.status(400).json({ error: "Validation Error", message: validation.error, field: validation.field });
        return;
      }

      const {
        algoA,
        algoB,
        scenario,
        limit: numLimit,
        windowSizeMs: numWindow,
        refillRatePerSec: numRefill,
        leakRatePerSec: numLeak,
      } = validation.data;

      const limiterA = createCompareLimiter(algoA as AlgorithmType, {
        limit: numLimit,
        windowSizeMs: numWindow,
        refillRatePerSec: numRefill,
        leakRatePerSec: numLeak,
      });

      const limiterB = createCompareLimiter(algoB as AlgorithmType, {
        limit: numLimit,
        windowSizeMs: numWindow,
        refillRatePerSec: numRefill,
        leakRatePerSec: numLeak,
      });

      interface SyntheticReq {
        key: string;
        timestampMs: number;
        cost: number;
      }
      const reqs: SyntheticReq[] = [];

      if (scenario === "window-boundary") {
        const key = "client-boundary-attacker";
        const t1 = numWindow - 100;
        const t2 = numWindow + 100;
        for (let i = 0; i < numLimit; i++) {
          reqs.push({ key, timestampMs: t1, cost: 1 });
        }
        for (let i = 0; i < numLimit; i++) {
          reqs.push({ key, timestampMs: t2, cost: 1 });
        }
      } else if (scenario === "burst-spike") {
        const key = "client-spike";
        for (let i = 0; i < 50; i++) {
          reqs.push({ key, timestampMs: i * 100, cost: 1 });
        }
        for (let i = 0; i < 150; i++) {
          reqs.push({ key, timestampMs: 5000 + i * 6, cost: 1 });
        }
        for (let i = 0; i < 50; i++) {
          reqs.push({ key, timestampMs: 10000 + i * 100, cost: 1 });
        }
      } else if (scenario === "heavy-client") {
        for (let i = 0; i < 200; i++) {
          const key = i % 5 === 0 ? "client-normal" : "client-heavy-monopolizer";
          reqs.push({ key, timestampMs: i * 100, cost: 1 });
        }
      } else {
        const key = "client-steady";
        for (let i = 0; i < 200; i++) {
          reqs.push({ key, timestampMs: i * 250, cost: 1 });
        }
      }

      let allowedA = 0;
      let rejectedA = 0;
      let totalLatA = 0;
      let lastStateA: Record<string, any> = {};

      let allowedB = 0;
      let rejectedB = 0;
      let totalLatB = 0;
      let lastStateB: Record<string, any> = {};

      const samples: Array<{
        index: number;
        clientId: string;
        timestampMs: number;
        allowedA: boolean;
        allowedB: boolean;
        remainingA: number;
        remainingB: number;
      }> = [];

      const minTime = reqs[0]?.timestampMs ?? 0;
      const maxTime = reqs[reqs.length - 1]?.timestampMs ?? numWindow;
      const bucketCount = 20;
      const timeSpan = Math.max(maxTime - minTime, 1);
      const bucketSize = Math.max(Math.ceil(timeSpan / bucketCount), 1);

      const timeline: Array<{
        bucketIndex: number;
        timeMs: number;
        allowedA: number;
        rejectedA: number;
        allowedB: number;
        rejectedB: number;
      }> = Array.from({ length: bucketCount }, (_, idx) => ({
        bucketIndex: idx,
        timeMs: minTime + idx * bucketSize,
        allowedA: 0,
        rejectedA: 0,
        allowedB: 0,
        rejectedB: 0,
      }));

      for (let i = 0; i < reqs.length; i++) {
        const item = reqs[i];
        const resA = await limiterA.evaluate({ key: item.key, timestampMs: item.timestampMs, cost: item.cost });
        const resB = await limiterB.evaluate({ key: item.key, timestampMs: item.timestampMs, cost: item.cost });

        if (resA.allowed) allowedA++;
        else rejectedA++;
        totalLatA += resA.decisionLatencyNs;
        lastStateA = resA.internalState;

        if (resB.allowed) allowedB++;
        else rejectedB++;
        totalLatB += resB.decisionLatencyNs;
        lastStateB = resB.internalState;

        const bIdx = Math.min(
          Math.floor((item.timestampMs - minTime) / bucketSize),
          bucketCount - 1
        );
        if (bIdx >= 0 && bIdx < bucketCount) {
          if (resA.allowed) timeline[bIdx].allowedA++;
          else timeline[bIdx].rejectedA++;

          if (resB.allowed) timeline[bIdx].allowedB++;
          else timeline[bIdx].rejectedB++;
        }

        if (i < 50 || i >= reqs.length - 10) {
          samples.push({
            index: i + 1,
            clientId: item.key,
            timestampMs: item.timestampMs,
            allowedA: resA.allowed,
            allowedB: resB.allowed,
            remainingA: resA.remaining,
            remainingB: resB.remaining,
          });
        }
      }

      const divergence = allowedA - allowedB;
      const boundaryLeakDetected =
        scenario === "window-boundary" &&
        ((algoA === "fixed-window" && allowedA > numLimit) ||
          (algoB === "fixed-window" && allowedB > numLimit));

      res.json({
        success: true,
        scenario,
        limit: numLimit,
        windowSizeMs: numWindow,
        totalRequests: reqs.length,
        divergence,
        boundaryLeakDetected,
        algoA: {
          algorithm: algoA,
          total: reqs.length,
          allowed: allowedA,
          rejected: rejectedA,
          avgLatencyNs: Math.round(totalLatA / Math.max(reqs.length, 1)),
          internalState: lastStateA,
        },
        algoB: {
          algorithm: algoB,
          total: reqs.length,
          allowed: allowedB,
          rejected: rejectedB,
          avgLatencyNs: Math.round(totalLatB / Math.max(reqs.length, 1)),
          internalState: lastStateB,
        },
        timeline,
        sampleRequests: samples,
      });
    });

    this.app.post("/api/simulator/start", (req: Request, res: Response) => {
      const validation = validateStartSimulator(req.body);
      if (!validation.ok) {
        res.status(400).json({ error: "Validation Error", message: validation.error, field: validation.field });
        return;
      }

      if (this.trafficEngine && this.trafficEngine.isRunning()) {
        this.trafficEngine.stop();
      }

      let engineConfig: TrafficEngineConfig = { ...(req.body || {}) };

      if (validation.data.scenario) {
        const preset = getPresetScenario(validation.data.scenario);
        this.currentScenario = validation.data.scenario;
        engineConfig = { ...preset, ...engineConfig };
      } else {
        this.currentScenario = "custom";
      }

      if (validation.data.targetRps !== undefined) engineConfig.targetRps = validation.data.targetRps;
      if (validation.data.clientCount !== undefined) engineConfig.clientCount = validation.data.clientCount;
      if (validation.data.pattern !== undefined) engineConfig.pattern = validation.data.pattern;
      if (validation.data.seed !== undefined) engineConfig.seed = validation.data.seed;
      if (validation.data.route !== undefined) engineConfig.route = validation.data.route;
      if (validation.data.cost !== undefined) engineConfig.cost = validation.data.cost;
      if (validation.data.durationMs !== undefined) engineConfig.durationMs = validation.data.durationMs;
      if (validation.data.burstMultiplier !== undefined) engineConfig.burstMultiplier = validation.data.burstMultiplier;

      engineConfig.onRequest = async (event: TrafficEvent) => {
        try {
          await this.dispatchTarget(event.route, {
            "x-client-id": event.clientId,
            "x-timestamp": String(event.timestampMs),
            "x-cost": String(event.cost),
          });
        } catch {
          // Ignore worker errors in background simulation
        }
      };

      this.trafficEngine = new TrafficEngine(engineConfig);
      this.trafficEngine.start();

      res.json({
        success: true,
        running: true,
        scenario: this.currentScenario,
        config: this.trafficEngine.config,
      });
    });

    this.app.post("/api/simulator/stop", (_req: Request, res: Response) => {
      if (!this.trafficEngine || !this.trafficEngine.isRunning()) {
        res.json({ success: true, running: false, stats: null });
        return;
      }

      const stats = this.trafficEngine.getStats();
      this.trafficEngine.stop();

      res.json({ success: true, running: false, stats });
    });

    this.app.post("/api/simulator/pause", (_req: Request, res: Response) => {
      if (this.trafficEngine) {
        this.trafficEngine.pause();
      }
      res.json({ success: true, paused: this.trafficEngine?.isPaused() ?? false });
    });

    this.app.post("/api/simulator/resume", (_req: Request, res: Response) => {
      if (this.trafficEngine) {
        this.trafficEngine.resume();
      }
      res.json({ success: true, paused: this.trafficEngine?.isPaused() ?? false });
    });

    this.app.post("/api/simulator/configure", async (req: Request, res: Response) => {
      const validation = validateConfigure(req.body || {});
      if (!validation.ok) {
        res.status(400).json({ error: "Validation Error", message: validation.error, field: validation.field });
        return;
      }

      if (validation.data.mode) this.mode = validation.data.mode;
      if (validation.data.algorithm) this.algorithm = validation.data.algorithm;
      if (validation.data.limit !== undefined) this.limit = validation.data.limit;
      if (validation.data.windowSizeMs !== undefined) this.windowSizeMs = validation.data.windowSizeMs;
      if (validation.data.refillRatePerSec !== undefined) this.refillRatePerSec = validation.data.refillRatePerSec;
      if (validation.data.leakRatePerSec !== undefined) this.leakRatePerSec = validation.data.leakRatePerSec;

      await this.broadcastConfig({
        mode: this.mode,
        algorithm: this.algorithm,
        limit: this.limit,
        windowSizeMs: this.windowSizeMs,
        refillRatePerSec: this.refillRatePerSec,
        leakRatePerSec: this.leakRatePerSec,
      });

      res.json({
        success: true,
        mode: this.mode,
        algorithm: this.algorithm,
        limit: this.limit,
        windowSizeMs: this.windowSizeMs,
        refillRatePerSec: this.refillRatePerSec,
        leakRatePerSec: this.leakRatePerSec,
      });
    });

    const dispatchRoundRobin = async (req: Request, res: Response) => {
      if (this.instances.length === 0) {
        res.status(503).json({ error: "No instances registered." });
        return;
      }

      const target = this.instances[this.rrIndex % this.instances.length];
      this.rrIndex++;

      try {
        const targetUrl = `${target.url}${req.path}`;
        const headers: Record<string, string> = {
          "content-type": "application/json",
        };

        if (req.headers["x-client-id"]) headers["x-client-id"] = String(req.headers["x-client-id"]);
        if (req.headers["x-timestamp"]) headers["x-timestamp"] = String(req.headers["x-timestamp"]);
        if (req.headers["x-cost"]) headers["x-cost"] = String(req.headers["x-cost"]);

        const response = await fetch(targetUrl, {
          method: req.method,
          headers,
          body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
          signal: AbortSignal.timeout(3000),
        });

        // Forward standard rate-limit headers
        const limitHeader = response.headers.get("x-ratelimit-limit");
        const remainingHeader = response.headers.get("x-ratelimit-remaining");
        const resetHeader = response.headers.get("x-ratelimit-reset");
        const algoHeader = response.headers.get("x-ratelimit-algorithm");
        const instHeader = response.headers.get("x-ratelimit-instance");
        const latHeader = response.headers.get("x-ratelimit-latency-ns");
        const retryHeader = response.headers.get("retry-after");

        if (limitHeader) res.setHeader("X-RateLimit-Limit", limitHeader);
        if (remainingHeader) res.setHeader("X-RateLimit-Remaining", remainingHeader);
        if (resetHeader) res.setHeader("X-RateLimit-Reset", resetHeader);
        if (algoHeader) res.setHeader("X-RateLimit-Algorithm", algoHeader);
        if (instHeader) res.setHeader("X-RateLimit-Instance", instHeader);
        if (latHeader) res.setHeader("X-RateLimit-Latency-Ns", latHeader);
        if (retryHeader) res.setHeader("Retry-After", retryHeader);

        const data = await response.json().catch(() => ({}));

        this.aggregator.record({
          allowed: response.status === 200,
          decisionLatencyNs: Number(latHeader) || 0,
          remaining: Number(remainingHeader) || 0,
          limit: Number(limitHeader) || 0,
          instanceId: instHeader || target.id,
          clientId: String(req.headers["x-client-id"] || "client-default"),
          route: req.path,
          internalState: data?.internalState,
        });

        res.status(response.status).json(data);
      } catch (err: any) {
        this.aggregator.record({
          allowed: false,
          decisionLatencyNs: 0,
          remaining: 0,
          limit: this.limit,
          instanceId: target.id,
          clientId: String(req.headers["x-client-id"] || "client-default"),
          route: req.path,
          internalState: { error: err?.message || "gateway_error" },
        });

        res.status(502).json({
          error: "Bad Gateway",
          target: target.id,
          message: err.message,
        });
      }
    };

    const limiterRoutes = [
      "/api/check",
      "/api/resource",
      "/api/login",
      "/api/search",
      "/api/pay",
      "/api/upload",
    ];

    limiterRoutes.forEach((route) => {
      this.app.all(route, dispatchRoundRobin);
    });
  }

  async dispatchTarget(route: string, headers: Record<string, string>): Promise<any> {
    if (this.instances.length === 0) return null;
    const target = this.instances[this.rrIndex % this.instances.length];
    this.rrIndex++;

    const targetUrl = `${target.url}${route}`;
    try {
      const resp = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(3000),
      });

      const data = await resp.json().catch(() => ({}));
      const latHeader = resp.headers.get("x-ratelimit-latency-ns");
      const limitHeader = resp.headers.get("x-ratelimit-limit");
      const remHeader = resp.headers.get("x-ratelimit-remaining");
      const instHeader = resp.headers.get("x-ratelimit-instance");

      this.aggregator.record({
        allowed: resp.status === 200,
        decisionLatencyNs: Number(latHeader) || 0,
        remaining: Number(remHeader) || 0,
        limit: Number(limitHeader) || 0,
        instanceId: instHeader || target.id,
        clientId: headers["x-client-id"] || "client-default",
        route,
        internalState: data?.internalState,
      });

      return resp;
    } catch (err: any) {
      this.aggregator.record({
        allowed: false,
        decisionLatencyNs: 0,
        remaining: 0,
        limit: this.limit,
        instanceId: target.id,
        clientId: headers["x-client-id"] || "client-default",
        route,
        internalState: { error: err?.message || "dispatch_failed" },
      });
      return null;
    }
  }

  async broadcastConfig(config: Record<string, any>): Promise<void> {
    await Promise.all(
      this.instances.map(async (inst) => {
        try {
          await fetch(`${inst.url}/api/configure`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(config),
            signal: AbortSignal.timeout(2000),
          });
        } catch {
          // Worker might be offline
        }
      })
    );
  }

  getApp(): Express {
    return this.app;
  }

  async start(): Promise<void> {
    this.aggregator.start();

    if (this.spawnedWorkers.length > 0) {
      await Promise.all(this.spawnedWorkers.map((w) => w.start()));
    }

    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.metricsStream.closeAll();
    this.aggregator.stop();

    if (this.trafficEngine) {
      this.trafficEngine.stop();
      this.trafficEngine = null;
    }

    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
    }

    if (this.spawnedWorkers.length > 0) {
      await Promise.all(this.spawnedWorkers.map((w) => w.stop()));
    }
  }
}

// Start if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const coordinator = new CoordinatorGateway({ spawnWorkers: true });
  await coordinator.start();
  console.log(`[coordinator] running on ${coordinator.host}:${coordinator.port} with 3 cluster instances`);
}
