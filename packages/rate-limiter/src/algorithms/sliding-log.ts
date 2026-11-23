import {
  IRateLimiter,
  LimiterRequest,
  LimiterResult,
  LimiterStateSnapshot,
} from "../types.js";

export interface SlidingLogOptions {
  limit: number;
  windowSizeMs: number;
}

export class SlidingLogLimiter implements IRateLimiter {
  readonly name = "sliding-log";

  readonly limit: number;
  readonly windowSizeMs: number;

  private logs = new Map<string, number[]>();

  constructor(options: SlidingLogOptions) {
    this.limit = options.limit;
    this.windowSizeMs = options.windowSizeMs;
  }

  async evaluate(req: LimiterRequest): Promise<LimiterResult> {
    const startTimeNs = process.hrtime.bigint();

    const cost = req.cost ?? 1;
    const threshold = req.timestampMs - this.windowSizeMs;

    let timestamps = this.logs.get(req.key) ?? [];

    let validIndex = 0;
    while (validIndex < timestamps.length && timestamps[validIndex] <= threshold) {
      validIndex++;
    }

    if (validIndex > 0) {
      timestamps = timestamps.slice(validIndex);
    }

    const currentCount = timestamps.length;
    const nextCount = currentCount + cost;
    const allowed = nextCount <= this.limit;

    let remaining: number;

    if (allowed) {
      for (let i = 0; i < cost; i++) {
        timestamps.push(req.timestampMs);
      }
      this.logs.set(req.key, timestamps);
      remaining = this.limit - timestamps.length;
    } else {
      remaining = Math.max(0, this.limit - currentCount);
      this.logs.set(req.key, timestamps);
    }

    const decisionLatencyNs = Number(process.hrtime.bigint() - startTimeNs);

    const earliestTimestamp = timestamps[0];
    const resetTimeMs = earliestTimestamp !== undefined
      ? earliestTimestamp + this.windowSizeMs
      : req.timestampMs + this.windowSizeMs;

    const retryAfterSec = allowed
      ? undefined
      : Math.max(1, Math.ceil((resetTimeMs - req.timestampMs) / 1000));

    const internalState: LimiterStateSnapshot = {
      algorithm: this.name,
      key: req.key,
      limit: this.limit,
      windowSizeMs: this.windowSizeMs,
      currentCount: timestamps.length,
      oldestTimestampMs: earliestTimestamp ?? null,
      newestTimestampMs: timestamps[timestamps.length - 1] ?? null,
      logSize: timestamps.length,
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
      this.logs.delete(key);
    } else {
      this.logs.clear();
    }
  }

  async getState(key: string): Promise<LimiterStateSnapshot> {
    const timestamps = this.logs.get(key) ?? [];

    return {
      algorithm: this.name,
      key,
      limit: this.limit,
      windowSizeMs: this.windowSizeMs,
      currentCount: timestamps.length,
      oldestTimestampMs: timestamps[0] ?? null,
      newestTimestampMs: timestamps[timestamps.length - 1] ?? null,
      logSize: timestamps.length,
    };
  }
}
