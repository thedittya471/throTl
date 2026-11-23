import {
  IRateLimiter,
  LimiterRequest,
  LimiterResult,
  LimiterStateSnapshot,
} from "../types.js";

export interface SlidingWindowCounterOptions {
  limit: number;
  windowSizeMs: number;
}

interface SlidingWindowRecord {
  windowIndex: number;
  prevCount: number;
  currCount: number;
}

export class SlidingWindowCounterLimiter implements IRateLimiter {
  readonly name = "sliding-window-counter";

  readonly limit: number;
  readonly windowSizeMs: number;

  private records = new Map<string, SlidingWindowRecord>();

  constructor(options: SlidingWindowCounterOptions) {
    this.limit = options.limit;
    this.windowSizeMs = options.windowSizeMs;
  }

  async evaluate(req: LimiterRequest): Promise<LimiterResult> {
    const startTimeNs = process.hrtime.bigint();

    const cost = req.cost ?? 1;
    const windowIndex = Math.floor(req.timestampMs / this.windowSizeMs);
    const windowStartMs = windowIndex * this.windowSizeMs;
    const resetTimeMs = windowStartMs + this.windowSizeMs;

    const elapsedMs = req.timestampMs - windowStartMs;
    const prevWeight = Math.max(0, 1 - elapsedMs / this.windowSizeMs);

    let record = this.records.get(req.key);

    if (!record) {
      record = { windowIndex, prevCount: 0, currCount: 0 };
    } else if (record.windowIndex === windowIndex - 1) {
      record = { windowIndex, prevCount: record.currCount, currCount: 0 };
    } else if (record.windowIndex !== windowIndex) {
      record = { windowIndex, prevCount: 0, currCount: 0 };
    }

    const estimatedCount = record.prevCount * prevWeight + record.currCount;
    const allowed = estimatedCount + cost <= this.limit;

    let remaining: number;

    if (allowed) {
      record.currCount += cost;
      this.records.set(req.key, record);
      const newEstimated = record.prevCount * prevWeight + record.currCount;
      remaining = Math.max(0, Math.floor(this.limit - newEstimated));
    } else {
      remaining = Math.max(0, Math.floor(this.limit - estimatedCount));
      this.records.set(req.key, record);
    }

    const decisionLatencyNs = Number(process.hrtime.bigint() - startTimeNs);

    const retryAfterSec = allowed
      ? undefined
      : Math.max(1, Math.ceil((resetTimeMs - req.timestampMs) / 1000));

    const internalState: LimiterStateSnapshot = {
      algorithm: this.name,
      key: req.key,
      limit: this.limit,
      windowSizeMs: this.windowSizeMs,
      windowIndex,
      windowStartMs,
      windowEndMs: resetTimeMs,
      prevCount: record.prevCount,
      currCount: record.currCount,
      prevWeight: Number(prevWeight.toFixed(4)),
      estimatedCount: Number(estimatedCount.toFixed(2)),
    };

    return {
      allowed,
      limit: this.limit,
      remaining,
      resetTimeMs,
      retryAfterSec,
      decisionLatencyNs,
      internalState,
    };
  }

  async reset(key?: string): Promise<void> {
    if (key) {
      this.records.delete(key);
    } else {
      this.records.clear();
    }
  }

  async getState(key: string): Promise<LimiterStateSnapshot> {
    const record = this.records.get(key);

    return {
      algorithm: this.name,
      key,
      limit: this.limit,
      windowSizeMs: this.windowSizeMs,
      windowIndex: record?.windowIndex ?? 0,
      prevCount: record?.prevCount ?? 0,
      currCount: record?.currCount ?? 0,
    };
  }
}
