import {
  IRateLimiter,
  LimiterRequest,
  LimiterResult,
  LimiterStateSnapshot,
} from "../types.js";

export interface LeakyBucketOptions {
  capacity: number;
  leakRatePerSec: number;
}

interface LeakyBucketRecord {
  level: number;
  lastLeakMs: number;
}

export class LeakyBucketLimiter implements IRateLimiter {
  readonly name = "leaky-bucket";

  readonly capacity: number;
  readonly leakRatePerSec: number;

  private buckets = new Map<string, LeakyBucketRecord>();

  constructor(options: LeakyBucketOptions) {
    this.capacity = options.capacity;
    this.leakRatePerSec = options.leakRatePerSec;
  }

  async evaluate(req: LimiterRequest): Promise<LimiterResult> {
    const startTimeNs = process.hrtime.bigint();

    const cost = req.cost ?? 1;
    let record = this.buckets.get(req.key);

    if (!record) {
      record = {
        level: 0,
        lastLeakMs: req.timestampMs,
      };
    } else {
      const elapsedMs = Math.max(0, req.timestampMs - record.lastLeakMs);
      const leakedAmount = (elapsedMs / 1000) * this.leakRatePerSec;
      record.level = Math.max(0, record.level - leakedAmount);
      record.lastLeakMs = req.timestampMs;
    }

    const nextLevel = record.level + cost;
    const allowed = nextLevel <= this.capacity;

    let remaining: number;
    let retryAfterSec: number | undefined;

    if (allowed) {
      record.level = nextLevel;
      remaining = Math.max(0, Math.floor(this.capacity - record.level));
    } else {
      remaining = Math.max(0, Math.floor(this.capacity - record.level));
      const overflow = nextLevel - this.capacity;
      const waitMs = (overflow / this.leakRatePerSec) * 1000;
      retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000));
    }

    this.buckets.set(req.key, record);

    const msUntilEmpty = (record.level / this.leakRatePerSec) * 1000;
    const resetTimeMs = req.timestampMs + Math.ceil(msUntilEmpty);

    const decisionLatencyNs = Number(process.hrtime.bigint() - startTimeNs);

    const internalState: LimiterStateSnapshot = {
      algorithm: this.name,
      key: req.key,
      capacity: this.capacity,
      leakRatePerSec: this.leakRatePerSec,
      level: Number(record.level.toFixed(2)),
      lastLeakMs: record.lastLeakMs,
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
      leakRatePerSec: this.leakRatePerSec,
      level: record ? Number(record.level.toFixed(2)) : 0,
      lastLeakMs: record?.lastLeakMs ?? 0,
    };
  }
}
