import {
  IRateLimiter,
  LimiterRequest,
  LimiterResult,
  LimiterStateSnapshot,
} from "../types.js";

export interface TokenBucketOptions {
  capacity: number;
  refillRatePerSec: number;
  initialTokens?: number;
}

interface BucketRecord {
  tokens: number;
  lastRefillMs: number;
}

export class TokenBucketLimiter implements IRateLimiter {
  readonly name = "token-bucket";

  readonly capacity: number;
  readonly refillRatePerSec: number;
  readonly initialTokens: number;

  private buckets = new Map<string, BucketRecord>();

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillRatePerSec = options.refillRatePerSec;
    this.initialTokens = options.initialTokens ?? options.capacity;
  }

  async evaluate(req: LimiterRequest): Promise<LimiterResult> {
    const startTimeNs = process.hrtime.bigint();

    const cost = req.cost ?? 1;
    let record = this.buckets.get(req.key);

    if (!record) {
      record = {
        tokens: this.initialTokens,
        lastRefillMs: req.timestampMs,
      };
    } else {
      const elapsedMs = Math.max(0, req.timestampMs - record.lastRefillMs);
      const refilledTokens = (elapsedMs / 1000) * this.refillRatePerSec;
      record.tokens = Math.min(this.capacity, record.tokens + refilledTokens);
      record.lastRefillMs = req.timestampMs;
    }

    const allowed = record.tokens >= cost;
    let remaining: number;
    let retryAfterSec: number | undefined;

    if (allowed) {
      record.tokens -= cost;
      remaining = Math.max(0, Math.floor(record.tokens));
    } else {
      remaining = Math.max(0, Math.floor(record.tokens));
      const deficit = cost - record.tokens;
      const waitMs = (deficit / this.refillRatePerSec) * 1000;
      retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000));
    }

    this.buckets.set(req.key, record);

    const msUntilFull = ((this.capacity - record.tokens) / this.refillRatePerSec) * 1000;
    const resetTimeMs = req.timestampMs + Math.ceil(msUntilFull);

    const decisionLatencyNs = Number(process.hrtime.bigint() - startTimeNs);

    const internalState: LimiterStateSnapshot = {
      algorithm: this.name,
      key: req.key,
      capacity: this.capacity,
      refillRatePerSec: this.refillRatePerSec,
      tokens: Number(record.tokens.toFixed(2)),
      lastRefillMs: record.lastRefillMs,
    };

    return {
      allowed,
      limit: this.capacity,
      remaining,
      resetTimeMs,
      retryAfterSec,
      decisionLatencyNs,
      internalState,
    };
  }

  async reset(key?: string): Promise<void> {
    if (key) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
    }
  }

  async getState(key: string): Promise<LimiterStateSnapshot> {
    const record = this.buckets.get(key);

    return {
      algorithm: this.name,
      key,
      capacity: this.capacity,
      refillRatePerSec: this.refillRatePerSec,
      tokens: record ? Number(record.tokens.toFixed(2)) : this.initialTokens,
      lastRefillMs: record?.lastRefillMs ?? 0,
    };
  }
}
