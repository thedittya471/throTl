import express, { type Request, type Response, type Express } from "express";
import { Server } from "node:http";
import {
  type IRateLimiter,
  FixedWindowLimiter,
  SlidingLogLimiter,
  SlidingWindowCounterLimiter,
  TokenBucketLimiter,
  LeakyBucketLimiter,
  RedisClientManager,
  RedisFixedWindowLimiter,
  RedisSlidingLogLimiter,
  RedisSlidingWindowCounterLimiter,
  RedisTokenBucketLimiter,
  RedisLeakyBucketLimiter,
} from "@throtl/rate-limiter";

export type LimiterMode = "per-instance" | "shared";

export type AlgorithmType =
  | "fixed-window"
  | "sliding-log"
  | "sliding-window-counter"
  | "token-bucket"
  | "leaky-bucket";

export interface InstanceConfig {
  instanceId?: string;
  port?: number;
  mode?: LimiterMode;
  algorithm?: AlgorithmType;
  limit?: number;
  windowSizeMs?: number;
  refillRatePerSec?: number;
  leakRatePerSec?: number;
  redisUrl?: string;
}

export class InstanceServer {
  readonly instanceId: string;
  readonly port: number;

  mode: LimiterMode;
  algorithm: AlgorithmType;
  limit: number;
  windowSizeMs: number;
  refillRatePerSec: number;
  leakRatePerSec: number;

  private redisManager?: RedisClientManager;
  private activeLimiter!: IRateLimiter;
  private app: Express;
  private server?: Server;

  constructor(config: InstanceConfig = {}) {
    this.instanceId = config.instanceId || process.env.INSTANCE_ID || "instance-1";
    this.port = config.port || Number(process.env.PORT) || 4001;

    this.mode = config.mode || (process.env.LIMITER_MODE as LimiterMode) || "per-instance";
    this.algorithm = config.algorithm || (process.env.ALGORITHM as AlgorithmType) || "fixed-window";

    this.limit = config.limit || 100;
    this.windowSizeMs = config.windowSizeMs || 60_000;
    this.refillRatePerSec = config.refillRatePerSec || 10;
    this.leakRatePerSec = config.leakRatePerSec || 10;

    const redisUrl = config.redisUrl || process.env.REDIS_URL || "redis://localhost:6379";
    this.redisManager = new RedisClientManager({ url: redisUrl });

    this.app = express();
    this.setupLimiter();
    this.setupRoutes();
  }

  private setupLimiter(): void {
    const isShared = this.mode === "shared";
    const redis = this.redisManager!.getClient();

    switch (this.algorithm) {
      case "fixed-window":
        this.activeLimiter = isShared
          ? new RedisFixedWindowLimiter(redis, {
              limit: this.limit,
              windowSizeMs: this.windowSizeMs,
            })
          : new FixedWindowLimiter({
              limit: this.limit,
              windowSizeMs: this.windowSizeMs,
            });
        break;

      case "sliding-log":
        this.activeLimiter = isShared
          ? new RedisSlidingLogLimiter(redis, {
              limit: this.limit,
              windowSizeMs: this.windowSizeMs,
            })
          : new SlidingLogLimiter({
              limit: this.limit,
              windowSizeMs: this.windowSizeMs,
            });
        break;

      case "sliding-window-counter":
        this.activeLimiter = isShared
          ? new RedisSlidingWindowCounterLimiter(redis, {
              limit: this.limit,
              windowSizeMs: this.windowSizeMs,
            })
          : new SlidingWindowCounterLimiter({
              limit: this.limit,
              windowSizeMs: this.windowSizeMs,
            });
        break;

      case "token-bucket":
        this.activeLimiter = isShared
          ? new RedisTokenBucketLimiter(redis, {
              capacity: this.limit,
              refillRatePerSec: this.refillRatePerSec,
            })
          : new TokenBucketLimiter({
              capacity: this.limit,
              refillRatePerSec: this.refillRatePerSec,
            });
        break;

      case "leaky-bucket":
        this.activeLimiter = isShared
          ? new RedisLeakyBucketLimiter(redis, {
              capacity: this.limit,
              leakRatePerSec: this.leakRatePerSec,
            })
          : new LeakyBucketLimiter({
              capacity: this.limit,
              leakRatePerSec: this.leakRatePerSec,
            });
        break;
    }
  }

  private setupRoutes(): void {
    this.app.use(express.json());

    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({
        status: "ok",
        instanceId: this.instanceId,
        mode: this.mode,
        algorithm: this.algorithm,
        limit: this.limit,
      });
    });

    this.app.post("/api/configure", (req: Request, res: Response) => {
      const { mode, algorithm, limit, windowSizeMs, refillRatePerSec, leakRatePerSec } = req.body;

      if (mode) this.mode = mode;
      if (algorithm) this.algorithm = algorithm;
      if (limit) this.limit = Number(limit);
      if (windowSizeMs) this.windowSizeMs = Number(windowSizeMs);
      if (refillRatePerSec) this.refillRatePerSec = Number(refillRatePerSec);
      if (leakRatePerSec) this.leakRatePerSec = Number(leakRatePerSec);

      this.setupLimiter();

      res.json({
        configured: true,
        instanceId: this.instanceId,
        mode: this.mode,
        algorithm: this.algorithm,
        limit: this.limit,
      });
    });

    this.app.post("/api/reset", async (_req: Request, res: Response) => {
      await this.activeLimiter.reset();
      res.json({ reset: true, instanceId: this.instanceId });
    });

    const handleEvaluation = async (req: Request, res: Response) => {
      const keyHeader = req.headers["x-client-id"];
      const key = (typeof keyHeader === "string" ? keyHeader : (req.query.clientId as string)) || req.ip || "client-default";

      const tsHeader = req.headers["x-timestamp"];
      const timestampMs = tsHeader
        ? Number(tsHeader)
        : req.query.timestampMs
        ? Number(req.query.timestampMs)
        : req.body?.timestampMs
        ? Number(req.body.timestampMs)
        : Date.now();

      const costHeader = req.headers["x-cost"];
      const cost = costHeader
        ? Number(costHeader)
        : req.query.cost
        ? Number(req.query.cost)
        : req.body?.cost
        ? Number(req.body.cost)
        : 1;

      const result = await this.activeLimiter.evaluate({
        key,
        timestampMs,
        cost,
      });

      // Standard Rate-Limit HTTP Headers
      res.setHeader("X-RateLimit-Limit", String(result.limit));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      res.setHeader("X-RateLimit-Reset", String(result.resetTimeMs));
      res.setHeader("X-RateLimit-Algorithm", this.activeLimiter.name);
      res.setHeader("X-RateLimit-Instance", this.instanceId);
      res.setHeader("X-RateLimit-Latency-Ns", String(result.decisionLatencyNs));

      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfterSec ?? 1));
        res.status(429).json({
          allowed: false,
          instanceId: this.instanceId,
          remaining: result.remaining,
          limit: result.limit,
          retryAfterSec: result.retryAfterSec ?? 1,
          internalState: result.internalState,
        });
        return;
      }

      res.status(200).json({
        allowed: true,
        instanceId: this.instanceId,
        remaining: result.remaining,
        limit: result.limit,
        internalState: result.internalState,
      });
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
      this.app.all(route, handleEvaluation);
    });
  }

  getApp(): Express {
    return this.app;
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => (err ? reject(err) : resolve()));
      });
    }

    if (this.redisManager) {
      await this.redisManager.close();
    }
  }
}

// Start if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const instance = new InstanceServer();
  await instance.start();
  console.log(`[${instance.instanceId}] running on port ${instance.port} (mode: ${instance.mode}, algorithm: ${instance.algorithm})`);
}
