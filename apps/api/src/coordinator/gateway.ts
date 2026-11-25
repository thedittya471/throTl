import express, { type Request, type Response, type Express } from "express";
import { Server } from "node:http";
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

export interface InstanceTarget {
  id: string;
  url: string;
}

export interface CoordinatorConfig {
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

export class CoordinatorGateway {
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
    this.port = config.port || Number(process.env.PORT) || 4000;
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
      this.instances = [
        { id: "instance-1", url: "http://localhost:4001" },
        { id: "instance-2", url: "http://localhost:4002" },
        { id: "instance-3", url: "http://localhost:4003" },
      ];
    }

    if (config.spawnWorkers) {
      this.spawnedWorkers = this.instances.map((target) => {
        const url = new URL(target.url);
        return new InstanceServer({
          instanceId: target.id,
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
            const resp = await fetch(`${inst.url}/health`);
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
      const { mode } = req.body;
      if (mode !== "per-instance" && mode !== "shared") {
        res.status(400).json({ error: "Invalid mode. Use 'per-instance' or 'shared'." });
        return;
      }

      this.mode = mode;

      await this.broadcastConfig({ mode });

      res.json({
        success: true,
        mode: this.mode,
      });
    });

    this.app.post("/api/simulator/algorithm", async (req: Request, res: Response) => {
      const { algorithm, limit, windowSizeMs, refillRatePerSec, leakRatePerSec } = req.body;

      if (algorithm) this.algorithm = algorithm;
      if (limit) this.limit = Number(limit);
      if (windowSizeMs) this.windowSizeMs = Number(windowSizeMs);
      if (refillRatePerSec) this.refillRatePerSec = Number(refillRatePerSec);
      if (leakRatePerSec) this.leakRatePerSec = Number(leakRatePerSec);

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
      await Promise.all(
        this.instances.map(async (inst) => {
          try {
            await fetch(`${inst.url}/api/reset`, { method: "POST" });
          } catch {
            // Ignore offline instances on reset
          }
        })
      );

      res.json({ success: true, reset: true });
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
      });
    });

    this.app.post("/api/simulator/start", (req: Request, res: Response) => {
      const {
        scenario,
        targetRps,
        clientCount,
        pattern,
        seed,
        route,
        cost,
        durationMs,
        ...rest
      } = req.body || {};

      if (this.trafficEngine && this.trafficEngine.isRunning()) {
        this.trafficEngine.stop();
      }

      let engineConfig: TrafficEngineConfig = { ...rest };

      if (scenario) {
        if (!PRESET_SCENARIOS[scenario as ScenarioName]) {
          res.status(400).json({
            error: `Unknown scenario: ${scenario}. Available: ${Object.keys(PRESET_SCENARIOS).join(", ")}`,
          });
          return;
        }
        const preset = getPresetScenario(scenario as ScenarioName);
        this.currentScenario = scenario;
        engineConfig = { ...preset, ...engineConfig };
      } else {
        this.currentScenario = "custom";
      }

      if (targetRps !== undefined) engineConfig.targetRps = Number(targetRps);
      if (clientCount !== undefined) engineConfig.clientCount = Number(clientCount);
      if (pattern !== undefined) engineConfig.pattern = pattern;
      if (seed !== undefined) engineConfig.seed = Number(seed);
      if (route !== undefined) engineConfig.route = route;
      if (cost !== undefined) engineConfig.cost = Number(cost);
      if (durationMs !== undefined) engineConfig.durationMs = Number(durationMs);

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
      const { mode, algorithm, limit, windowSizeMs, refillRatePerSec, leakRatePerSec } = req.body || {};

      if (mode) this.mode = mode;
      if (algorithm) this.algorithm = algorithm;
      if (limit) this.limit = Number(limit);
      if (windowSizeMs) this.windowSizeMs = Number(windowSizeMs);
      if (refillRatePerSec) this.refillRatePerSec = Number(refillRatePerSec);
      if (leakRatePerSec) this.leakRatePerSec = Number(leakRatePerSec);

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

        const data = await response.json();

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
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({}),
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
  }

  async broadcastConfig(config: Record<string, any>): Promise<void> {
    await Promise.all(
      this.instances.map(async (inst) => {
        try {
          await fetch(`${inst.url}/api/configure`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(config),
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
      this.server = this.app.listen(this.port, () => {
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
  console.log(`[coordinator] running on port ${coordinator.port} with 3 cluster instances`);
}
