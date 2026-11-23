import {
  IRateLimiter,
  LimiterRequest,
  LimiterResult,
  LimiterStateSnapshot,
} from "../types.js";

export interface FixedWindowOptions {
  limit: number;
  windowSizeMs: number;
}

interface WindowRecord {
  count: number;
  windowIndex: number;
}

export class FixedWindowLimiter implements IRateLimiter {
  readonly name = "fixed-window";

  readonly limit: number;
  readonly windowSizeMs: number;

  private records = new Map<string, WindowRecord>();

  constructor(options: FixedWindowOptions) {
    this.limit = options.limit;
    this.windowSizeMs = options.windowSizeMs;
  }

  async evaluate(req: LimiterRequest): Promise<LimiterResult> {
    const startTimeNs = process.hrtime.bigint();

    const cost = req.cost ?? 1;
    const windowIndex = Math.floor(req.timestampMs / this.windowSizeMs);
    const windowStartMs = windowIndex * this.windowSizeMs;
    const resetTimeMs = windowStartMs + this.windowSizeMs;

    let record = this.records.get(req.key);

    if (!record || record.windowIndex !== windowIndex) {
      record = { count: 0, windowIndex };
    }

    const nextCount = record.count + cost;
    const allowed = nextCount <= this.limit;

    let remaining: number;

    if (allowed) {
      record.count = nextCount;
      this.records.set(req.key, record);
      remaining = this.limit - record.count;
    } else {
      remaining = Math.max(0, this.limit - record.count);
    }

    const decisionLatencyNs = Number(process.hrtime.bigint() - startTimeNs);

    const retryAfterSec = allowed
      ? undefined
      : Math.max(1, Math.ceil((resetTimeMs - req.timestampMs) / 1000));

    const internalState: LimiterStateSnapshot = {
      algorithm: this.name,
      key: req.key,
      limit: this.limit,
      count: record.count,
      windowSizeMs: this.windowSizeMs,
      windowStartMs,
      windowEndMs: resetTimeMs,
      windowIndex,
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
      count: record?.count ?? 0,
      windowIndex: record?.windowIndex ?? 0,
    };
  }
}
