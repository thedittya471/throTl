import { Redis } from "ioredis";
import {
  IRateLimiter,
  LimiterRequest,
  LimiterResult,
  LimiterStateSnapshot,
} from "../types.js";
import { LuaScriptManager } from "./lua-manager.js";
import {
  FIXED_WINDOW_LUA,
  SLIDING_LOG_LUA,
  SLIDING_WINDOW_COUNTER_LUA,
  TOKEN_BUCKET_LUA,
  LEAKY_BUCKET_LUA,
} from "./scripts.js";

// ==========================================
// 1. Redis Fixed Window Limiter
// ==========================================
export interface RedisFixedWindowOptions {
  limit: number;
  windowSizeMs: number;
  keyPrefix?: string;
}

export class RedisFixedWindowLimiter implements IRateLimiter {
  readonly name = "fixed-window";
  readonly limit: number;
  readonly windowSizeMs: number;
  private keyPrefix: string;
  private redis: Redis;
  private lua: LuaScriptManager;

  constructor(redis: Redis, options: RedisFixedWindowOptions) {
    this.redis = redis;
    this.limit = options.limit;
    this.windowSizeMs = options.windowSizeMs;
    this.keyPrefix = options.keyPrefix ?? "ratelab:fw:";
    this.lua = new LuaScriptManager(redis);
  }

  async init(): Promise<void> {
    await this.lua.registerScript("fixed_window", FIXED_WINDOW_LUA);
  }

  async evaluate(req: LimiterRequest): Promise<LimiterResult> {
    const startTimeNs = process.hrtime.bigint();
    const cost = req.cost ?? 1;
    const redisKey = `${this.keyPrefix}${req.key}`;

    if (!this.lua.hasScript("fixed_window")) {
      await this.init();
    }

    const res = await this.lua.runScript<number[]>(
      "fixed_window",
      [redisKey],
      [req.timestampMs, this.limit, this.windowSizeMs, cost]
    );

    const [
      allowedNum,
      remaining,
      resetTimeMs,
      retryAfterSec,
      currentCount,
      limit,
      windowSizeMs,
      windowStartMs,
      windowEndMs,
      windowIndex,
    ] = res;

    const allowed = allowedNum === 1;
    const decisionLatencyNs = Number(process.hrtime.bigint() - startTimeNs);

    const internalState: LimiterStateSnapshot = {
      algorithm: this.name,
      key: req.key,
      limit,
      count: currentCount,
      windowSizeMs,
      windowStartMs,
      windowEndMs,
      windowIndex,
    };

    return {
      allowed,
      limit: this.limit,
      remaining,
      resetTimeMs,
      retryAfterSec: allowed ? undefined : retryAfterSec,
      decisionLatencyNs,
      internalState,
    };
  }

  async reset(key?: string): Promise<void> {
    if (key) {
      const pattern = `${this.keyPrefix}${key}*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } else {
      const pattern = `${this.keyPrefix}*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  async getState(key: string): Promise<LimiterStateSnapshot> {
    const pattern = `${this.keyPrefix}${key}:*`;
    const keys = await this.redis.keys(pattern);
    let count = 0;

    if (keys.length > 0) {
      const val = await this.redis.get(keys[keys.length - 1]);
      count = val ? parseInt(val, 10) : 0;
    }

    return {
      algorithm: this.name,
      key,
      limit: this.limit,
      windowSizeMs: this.windowSizeMs,
      count,
    };
  }
}

// ==========================================
// 2. Redis Sliding Log Limiter
// ==========================================
export interface RedisSlidingLogOptions {
  limit: number;
  windowSizeMs: number;
  keyPrefix?: string;
}

export class RedisSlidingLogLimiter implements IRateLimiter {
  readonly name = "sliding-log";
  readonly limit: number;
  readonly windowSizeMs: number;
  private keyPrefix: string;
  private redis: Redis;
  private lua: LuaScriptManager;

  constructor(redis: Redis, options: RedisSlidingLogOptions) {
    this.redis = redis;
    this.limit = options.limit;
    this.windowSizeMs = options.windowSizeMs;
    this.keyPrefix = options.keyPrefix ?? "ratelab:sl:";
    this.lua = new LuaScriptManager(redis);
  }

  async init(): Promise<void> {
    await this.lua.registerScript("sliding_log", SLIDING_LOG_LUA);
  }

  async evaluate(req: LimiterRequest): Promise<LimiterResult> {
    const startTimeNs = process.hrtime.bigint();
    const cost = req.cost ?? 1;
    const redisKey = `${this.keyPrefix}${req.key}`;

    if (!this.lua.hasScript("sliding_log")) {
      await this.init();
    }

    const res = await this.lua.runScript<number[]>(
      "sliding_log",
      [redisKey],
      [req.timestampMs, this.limit, this.windowSizeMs, cost]
    );

    const [allowedNum, remaining, resetTimeMs, retryAfterSec, count] = res;
    const allowed = allowedNum === 1;
    const decisionLatencyNs = Number(process.hrtime.bigint() - startTimeNs);

    const internalState: LimiterStateSnapshot = {
      algorithm: this.name,
      key: req.key,
      limit: this.limit,
      windowSizeMs: this.windowSizeMs,
      currentCount: count,
      logSize: count,
    };

    return {
      allowed,
      limit: this.limit,
      remaining,
      resetTimeMs,
      retryAfterSec: allowed ? undefined : retryAfterSec,
      decisionLatencyNs,
      internalState,
    };
  }

  async reset(key?: string): Promise<void> {
    if (key) {
      await this.redis.del(`${this.keyPrefix}${key}`, `${this.keyPrefix}${key}:seq`);
    } else {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  async getState(key: string): Promise<LimiterStateSnapshot> {
    const count = await this.redis.zcard(`${this.keyPrefix}${key}`);

    return {
      algorithm: this.name,
      key,
      limit: this.limit,
      windowSizeMs: this.windowSizeMs,
      currentCount: count,
      logSize: count,
    };
  }
}

// ==========================================
// 3. Redis Sliding Window Counter Limiter
// ==========================================
export interface RedisSlidingWindowCounterOptions {
  limit: number;
  windowSizeMs: number;
  keyPrefix?: string;
}

export class RedisSlidingWindowCounterLimiter implements IRateLimiter {
  readonly name = "sliding-window-counter";
  readonly limit: number;
  readonly windowSizeMs: number;
  private keyPrefix: string;
  private redis: Redis;
  private lua: LuaScriptManager;

  constructor(redis: Redis, options: RedisSlidingWindowCounterOptions) {
    this.redis = redis;
    this.limit = options.limit;
    this.windowSizeMs = options.windowSizeMs;
    this.keyPrefix = options.keyPrefix ?? "ratelab:swc:";
    this.lua = new LuaScriptManager(redis);
  }

  async init(): Promise<void> {
    await this.lua.registerScript("sliding_window_counter", SLIDING_WINDOW_COUNTER_LUA);
  }

  async evaluate(req: LimiterRequest): Promise<LimiterResult> {
    const startTimeNs = process.hrtime.bigint();
    const cost = req.cost ?? 1;
    const redisKey = `${this.keyPrefix}${req.key}`;

    if (!this.lua.hasScript("sliding_window_counter")) {
      await this.init();
    }

    const res = await this.lua.runScript<number[]>(
      "sliding_window_counter",
      [redisKey],
      [req.timestampMs, this.limit, this.windowSizeMs, cost]
    );

    const [
      allowedNum,
      remaining,
      resetTimeMs,
      retryAfterSec,
      prevCount,
      currCount,
      estimatedCount,
      weightInt,
    ] = res;

    const allowed = allowedNum === 1;
    const decisionLatencyNs = Number(process.hrtime.bigint() - startTimeNs);

    const internalState: LimiterStateSnapshot = {
      algorithm: this.name,
      key: req.key,
      limit: this.limit,
      windowSizeMs: this.windowSizeMs,
      prevCount,
      currCount,
      estimatedCount,
      prevWeight: weightInt / 1000,
    };

    return {
      allowed,
      limit: this.limit,
      remaining,
      resetTimeMs,
      retryAfterSec: allowed ? undefined : retryAfterSec,
      decisionLatencyNs,
      internalState,
    };
  }

  async reset(key?: string): Promise<void> {
    if (key) {
      await this.redis.del(`${this.keyPrefix}${key}`);
    } else {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  async getState(key: string): Promise<LimiterStateSnapshot> {
    const data = await this.redis.hmget(`${this.keyPrefix}${key}`, "prevCount", "currCount");

    return {
      algorithm: this.name,
      key,
      limit: this.limit,
      windowSizeMs: this.windowSizeMs,
      prevCount: parseInt(data[0] || "0", 10),
      currCount: parseInt(data[1] || "0", 10),
    };
  }
}

// ==========================================
// 4. Redis Token Bucket Limiter
// ==========================================
export interface RedisTokenBucketOptions {
  capacity: number;
  refillRatePerSec: number;
  keyPrefix?: string;
}

export class RedisTokenBucketLimiter implements IRateLimiter {
  readonly name = "token-bucket";
  readonly capacity: number;
  readonly refillRatePerSec: number;
  private keyPrefix: string;
  private redis: Redis;
  private lua: LuaScriptManager;

  constructor(redis: Redis, options: RedisTokenBucketOptions) {
    this.redis = redis;
    this.capacity = options.capacity;
    this.refillRatePerSec = options.refillRatePerSec;
    this.keyPrefix = options.keyPrefix ?? "ratelab:tb:";
    this.lua = new LuaScriptManager(redis);
  }

  async init(): Promise<void> {
    await this.lua.registerScript("token_bucket", TOKEN_BUCKET_LUA);
  }

  async evaluate(req: LimiterRequest): Promise<LimiterResult> {
    const startTimeNs = process.hrtime.bigint();
    const cost = req.cost ?? 1;
    const redisKey = `${this.keyPrefix}${req.key}`;

    if (!this.lua.hasScript("token_bucket")) {
      await this.init();
    }

    const res = await this.lua.runScript<number[]>(
      "token_bucket",
      [redisKey],
      [req.timestampMs, this.capacity, this.refillRatePerSec, cost]
    );

    const [allowedNum, remaining, resetTimeMs, retryAfterSec, tokensScaled, lastRefillMs] = res;
    const allowed = allowedNum === 1;
    const decisionLatencyNs = Number(process.hrtime.bigint() - startTimeNs);

    const internalState: LimiterStateSnapshot = {
      algorithm: this.name,
      key: req.key,
      capacity: this.capacity,
      refillRatePerSec: this.refillRatePerSec,
      tokens: tokensScaled / 100,
      lastRefillMs,
    };

    return {
      allowed,
      limit: this.capacity,
      remaining,
      resetTimeMs,
      retryAfterSec: allowed ? undefined : retryAfterSec,
      decisionLatencyNs,
      internalState,
    };
  }

  async reset(key?: string): Promise<void> {
    if (key) {
      await this.redis.del(`${this.keyPrefix}${key}`);
    } else {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  async getState(key: string): Promise<LimiterStateSnapshot> {
    const data = await this.redis.hmget(`${this.keyPrefix}${key}`, "tokens", "lastRefillMs");

    return {
      algorithm: this.name,
      key,
      capacity: this.capacity,
      refillRatePerSec: this.refillRatePerSec,
      tokens: data[0] ? parseFloat(data[0]) : this.capacity,
      lastRefillMs: data[1] ? parseInt(data[1], 10) : 0,
    };
  }
}

// ==========================================
// 5. Redis Leaky Bucket Limiter
// ==========================================
export interface RedisLeakyBucketOptions {
  capacity: number;
  leakRatePerSec: number;
  keyPrefix?: string;
}

export class RedisLeakyBucketLimiter implements IRateLimiter {
  readonly name = "leaky-bucket";
  readonly capacity: number;
  readonly leakRatePerSec: number;
  private keyPrefix: string;
  private redis: Redis;
  private lua: LuaScriptManager;

  constructor(redis: Redis, options: RedisLeakyBucketOptions) {
    this.redis = redis;
    this.capacity = options.capacity;
    this.leakRatePerSec = options.leakRatePerSec;
    this.keyPrefix = options.keyPrefix ?? "ratelab:lb:";
    this.lua = new LuaScriptManager(redis);
  }

  async init(): Promise<void> {
    await this.lua.registerScript("leaky_bucket", LEAKY_BUCKET_LUA);
  }

  async evaluate(req: LimiterRequest): Promise<LimiterResult> {
    const startTimeNs = process.hrtime.bigint();
    const cost = req.cost ?? 1;
    const redisKey = `${this.keyPrefix}${req.key}`;

    if (!this.lua.hasScript("leaky_bucket")) {
      await this.init();
    }

    const res = await this.lua.runScript<number[]>(
      "leaky_bucket",
      [redisKey],
      [req.timestampMs, this.capacity, this.leakRatePerSec, cost]
    );

    const [allowedNum, remaining, resetTimeMs, retryAfterSec, levelScaled, lastLeakMs] = res;
    const allowed = allowedNum === 1;
    const decisionLatencyNs = Number(process.hrtime.bigint() - startTimeNs);

    const internalState: LimiterStateSnapshot = {
      algorithm: this.name,
      key: req.key,
      capacity: this.capacity,
      leakRatePerSec: this.leakRatePerSec,
      level: levelScaled / 100,
      lastLeakMs,
    };

    return {
      allowed,
      limit: this.capacity,
      remaining,
      resetTimeMs,
      retryAfterSec: allowed ? undefined : retryAfterSec,
      decisionLatencyNs,
      internalState,
    };
  }

  async reset(key?: string): Promise<void> {
    if (key) {
      await this.redis.del(`${this.keyPrefix}${key}`);
    } else {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  async getState(key: string): Promise<LimiterStateSnapshot> {
    const data = await this.redis.hmget(`${this.keyPrefix}${key}`, "level", "lastLeakMs");

    return {
      algorithm: this.name,
      key,
      capacity: this.capacity,
      leakRatePerSec: this.leakRatePerSec,
      level: data[0] ? parseFloat(data[0]) : 0,
      lastLeakMs: data[1] ? parseInt(data[1], 10) : 0,
    };
  }
}
