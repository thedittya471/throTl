import { parseRunTelemetry, type RunTelemetry } from './telemetry.ts';

export type RunConfig = {
  durationMs: number;
  ratePerSecond: number;
  limit: number;
  windowMs: number;
  stateMode?: 'local' | 'shared';
};

export const DEFAULT_RUN_CONFIG: RunConfig = {
  durationMs: 10_000, ratePerSecond: 10, limit: 5, windowMs: 1_000,
};

export function parseRunConfig(input: unknown): RunConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Expected a run configuration object');
  }
  const values = input as Record<string, unknown>;
  const bounds = { durationMs: [100, 120_000], ratePerSecond: [1, 1_000], limit: [1, 1_000], windowMs: [1, 60_000] } as const;
  if (Object.keys(values).some((key) => !Object.hasOwn(bounds, key) && key !== 'stateMode')) {
    throw new Error('Unknown run setting');
  }
  if (values.stateMode !== undefined && !['local', 'shared'].includes(values.stateMode as string)) {
    throw new Error('stateMode must be local or shared');
  }
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const value = values[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${key} must be an integer from ${min} to ${max}`);
    }
  }
  return {
    durationMs: values.durationMs as number, ratePerSecond: values.ratePerSecond as number,
    limit: values.limit as number, windowMs: values.windowMs as number,
    ...(values.stateMode === undefined ? {} : { stateMode: values.stateMode as 'local' | 'shared' }),
  };
}

export type RunCounts = {
  scheduled: number;
  dispatched: number;
  responseReceived: number;
  allowed: number;
  rejected: number;
  unknownDecision: number;
  transportFailed: number;
  cancelled: number;
  timedOut: number;
  inFlight: number;
  missed: number;
  missedLate: number;
  missedInFlight: number;
  missedCancelled: number;
};

export type RunSnapshot = {
  version: 1;
  id: string;
  status: 'running' | 'draining' | 'stopping' | 'completed' | 'stopped' | 'failed';
  error?: 'REDIS_UNAVAILABLE';
  config: RunConfig;
  counts: RunCounts;
  telemetry?: RunTelemetry;
  instances?: { id: string; counts: RunCounts }[];
};

export function parseRunSnapshot(input: unknown): RunSnapshot {
  const run = input as Partial<RunSnapshot> | null;
  if (!run || run.version !== 1 || typeof run.id !== 'string' ||
      !/^[a-f0-9]{32}$/.test(run.id) ||
      !['running', 'draining', 'stopping', 'completed', 'stopped', 'failed'].includes(run.status ?? '') ||
      !run.counts || typeof run.counts !== 'object') {
    throw new Error('Invalid run response');
  }
  if ((run.error !== undefined && run.error !== 'REDIS_UNAVAILABLE') ||
      (run.status === 'failed' && run.error !== 'REDIS_UNAVAILABLE')) throw new Error('Invalid run error');
  const names: (keyof RunCounts)[] = ['scheduled', 'dispatched', 'responseReceived', 'allowed',
    'rejected', 'unknownDecision', 'transportFailed', 'cancelled', 'timedOut', 'inFlight',
    'missed', 'missedLate', 'missedInFlight', 'missedCancelled'];
  for (const key of names) {
    if (!Number.isSafeInteger(run.counts[key]) || run.counts[key] < 0) {
      throw new Error('Invalid run counters');
    }
  }
  if (run.instances !== undefined && (!Array.isArray(run.instances) || run.instances.length < 1 || run.instances.length > 3 ||
      new Set(run.instances.map((item) => item.id)).size !== run.instances.length ||
      run.instances.some((item) => !item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(item.id) ||
        !item.counts || names.some((key) => !Number.isSafeInteger(item.counts[key]) || item.counts[key] < 0)))) {
    throw new Error('Invalid run instances');
  }
  return { version: 1, id: run.id, status: run.status as RunSnapshot['status'],
    config: parseRunConfig(run.config), counts: run.counts,
    ...(run.error === undefined ? {} : { error: run.error }),
    ...(run.instances === undefined ? {} : { instances: run.instances }),
    ...(run.telemetry === undefined ? {} : { telemetry: parseRunTelemetry(run.telemetry) }) };
}
