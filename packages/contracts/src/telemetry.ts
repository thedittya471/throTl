import type { FixedWindowDemoResponse } from './index.ts';

export const MAX_TIMELINE_POINTS = 120;
export const MAX_DECISION_DETAILS = 50;
export type DecisionDetail = {
  instance?: string;
  sequence: number;
  elapsedMs: number;
  decision: FixedWindowDemoResponse['decision'];
};
export type RunTelemetry = {
  evaluated: number;
  allowed: number;
  rejected: number;
  timeline: { elapsedMs: number; allowed: number; rejected: number }[];
  recent: DecisionDetail[];
};

const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parseFixedWindowDecision(input: unknown): FixedWindowDemoResponse['decision'] {
  const decision = input as FixedWindowDemoResponse['decision'] | null;
  const state = decision?.state;
  if (!decision || !state ||
      typeof decision.allowed !== 'boolean' ||
      decision.reason !== (decision.allowed ? 'within_limit' : 'limit_exhausted') ||
      !integer(decision.remaining) || !integer(decision.resetAtMs) || !integer(decision.retryAfterMs) ||
      !integer(state.limit) || state.limit < 1 || !integer(state.windowStartMs) ||
      !integer(state.countBefore) || !integer(state.countAfter) || state.countAfter > state.limit ||
      !integer(state.rawTimeMs) || !integer(state.effectiveTimeMs) || typeof state.clockClamped !== 'boolean' ||
      state.countBefore > state.limit || state.countAfter !== state.countBefore + (decision.allowed ? 1 : 0) ||
      decision.remaining !== state.limit - state.countAfter ||
      state.effectiveTimeMs < state.rawTimeMs || state.windowStartMs > state.effectiveTimeMs ||
      decision.resetAtMs <= state.effectiveTimeMs ||
      state.clockClamped !== (state.rawTimeMs !== state.effectiveTimeMs) ||
      decision.retryAfterMs !== (decision.allowed ? 0 : decision.resetAtMs - state.rawTimeMs)) {
    throw new Error('Invalid decision detail');
  }
  return decision;
}

export function parseRunTelemetry(input: unknown): RunTelemetry {
  const data = input as RunTelemetry | null;
  if (!data || !integer(data.evaluated) || !integer(data.allowed) || !integer(data.rejected) ||
      data.evaluated !== data.allowed + data.rejected ||
      !Array.isArray(data.timeline) || data.timeline.length > MAX_TIMELINE_POINTS ||
      !Array.isArray(data.recent) || data.recent.length > MAX_DECISION_DETAILS) {
    throw new Error('Invalid run telemetry');
  }
  let previousBucket = -1;
  for (const point of data.timeline) {
    if (!point || !integer(point.elapsedMs) || !integer(point.allowed) || !integer(point.rejected) ||
        point.elapsedMs % 1_000 !== 0 || point.elapsedMs <= previousBucket) {
      throw new Error('Invalid timeline point');
    }
    previousBucket = point.elapsedMs;
  }
  let previousSequence = 0;
  for (const detail of data.recent) {
    if (!detail || (detail.instance !== undefined && (typeof detail.instance !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(detail.instance))) || !integer(detail.sequence) || detail.sequence < 1 || detail.sequence > data.evaluated || detail.sequence <= previousSequence ||
        !integer(detail.elapsedMs)) {
      throw new Error('Invalid decision detail');
    }
    parseFixedWindowDecision(detail.decision);
    previousSequence = detail.sequence;
  }
  return data;
}
