export interface LimiterRequest {
  key: string;
  timestampMs: number;
  cost?: number;
}

export interface LimiterStateSnapshot {
  algorithm: string;
  key: string;
  [key: string]: unknown;
}

export interface LimiterResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTimeMs: number;
  retryAfterSec?: number;
  decisionLatencyNs: number;
  internalState: LimiterStateSnapshot;
}

export interface IRateLimiter {
  readonly name: string;

  evaluate(req: LimiterRequest): Promise<LimiterResult>;

  reset(key?: string): Promise<void>;

  getState(key: string): Promise<LimiterStateSnapshot>;
}
