export const CONTRACT_VERSION = 1;

export type HealthResponse = {
  version: typeof CONTRACT_VERSION;
  status: 'ok';
  service: 'ratelab-api';
};

export function parseHealthResponse(input: unknown): HealthResponse {
  if (typeof input !== 'object' || input === null ||
      !('version' in input) || input.version !== CONTRACT_VERSION ||
      !('status' in input) || input.status !== 'ok' ||
      !('service' in input) || input.service !== 'ratelab-api') {
    throw new Error('Unsupported API health response');
  }
  return { version: CONTRACT_VERSION, status: 'ok', service: 'ratelab-api' };
}

export type FixedWindowState = {
  limit: number;
  windowStartMs: number;
  countBefore: number;
  countAfter: number;
  rawTimeMs: number;
  effectiveTimeMs: number;
  clockClamped: boolean;
};

export type FixedWindowDemoResponse = {
  version: typeof CONTRACT_VERSION;
  algorithm: 'fixed-window';
  instance: string;
  decision: {
    allowed: boolean;
    reason: 'within_limit' | 'limit_exhausted';
    remaining: number;
    resetAtMs: number;
    retryAfterMs: number;
    state: FixedWindowState;
  };
};

export { DEFAULT_RUN_CONFIG, parseRunConfig, parseRunSnapshot } from './runs.ts';
export type { RunConfig, RunCounts, RunSnapshot } from './runs.ts';

export { MAX_TIMELINE_POINTS, MAX_DECISION_DETAILS, parseRunTelemetry, parseFixedWindowDecision } from './telemetry.ts';
export type { RunTelemetry, DecisionDetail } from './telemetry.ts';
