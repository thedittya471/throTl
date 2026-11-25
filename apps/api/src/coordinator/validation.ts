import type { LimiterMode, AlgorithmType } from "../instance.js";
import type { TrafficPattern } from "../traffic/engine.js";
import type { ScenarioName } from "../traffic/scenarios.js";

export const SUPPORTED_ALGORITHMS: readonly AlgorithmType[] = [
  "fixed-window",
  "sliding-log",
  "sliding-window-counter",
  "token-bucket",
  "leaky-bucket",
];

export const SUPPORTED_MODES: readonly LimiterMode[] = [
  "per-instance",
  "shared",
];

export const SUPPORTED_PATTERNS: readonly TrafficPattern[] = [
  "steady",
  "burst",
  "ramp-up",
  "sawtooth",
  "window-boundary",
  "heavy-client",
];

export const SUPPORTED_PRESETS: readonly ScenarioName[] = [
  "login-brute-force",
  "search-spike",
  "payment-retries",
  "file-uploads",
];

export const SUPPORTED_COMPARE_SCENARIOS = [
  "window-boundary",
  "burst-spike",
  "heavy-client",
  "steady-overload",
] as const;

export type CompareScenario = (typeof SUPPORTED_COMPARE_SCENARIOS)[number];

export const SUPPORTED_ROUTES = [
  "/api/check",
  "/api/login",
  "/api/search",
  "/api/pay",
  "/api/upload",
] as const;

export const MAX_REPLAY_LIMIT = 5000;
export const MAX_EFFECTIVE_BURST_RPS = 50000;

export interface ValidationSuccess<T> {
  ok: true;
  data: T;
}

export interface ValidationFailure {
  ok: false;
  status: 400;
  error: string;
  field?: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function isIntegerInRange(val: unknown, min: number, max: number): val is number {
  return typeof val === "number" && Number.isInteger(val) && val >= min && val <= max;
}

function isNumberInRange(val: unknown, min: number, max: number): val is number {
  return typeof val === "number" && Number.isFinite(val) && val >= min && val <= max;
}

export function validateMode(mode: unknown): ValidationResult<LimiterMode> {
  if (typeof mode !== "string" || !SUPPORTED_MODES.includes(mode as LimiterMode)) {
    return {
      ok: false,
      status: 400,
      field: "mode",
      error: `Invalid mode: '${mode}'. Supported modes: ${SUPPORTED_MODES.join(", ")}`,
    };
  }
  return { ok: true, data: mode as LimiterMode };
}

export function validateAlgorithm(algorithm: unknown): ValidationResult<AlgorithmType> {
  if (typeof algorithm !== "string" || !SUPPORTED_ALGORITHMS.includes(algorithm as AlgorithmType)) {
    return {
      ok: false,
      status: 400,
      field: "algorithm",
      error: `Invalid algorithm: '${algorithm}'. Supported algorithms: ${SUPPORTED_ALGORITHMS.join(", ")}`,
    };
  }
  return { ok: true, data: algorithm as AlgorithmType };
}

export interface ConfigureInput {
  mode?: LimiterMode;
  algorithm?: AlgorithmType;
  limit?: number;
  windowSizeMs?: number;
  refillRatePerSec?: number;
  leakRatePerSec?: number;
}

export function validateConfigure(body: any): ValidationResult<ConfigureInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Request body must be a JSON object" };
  }

  const result: ConfigureInput = {};

  if (body.mode !== undefined) {
    const v = validateMode(body.mode);
    if (!v.ok) return v;
    result.mode = v.data;
  }

  if (body.algorithm !== undefined) {
    const v = validateAlgorithm(body.algorithm);
    if (!v.ok) return v;
    result.algorithm = v.data;
  }

  if (body.limit !== undefined) {
    if (!isIntegerInRange(body.limit, 1, 100000)) {
      return {
        ok: false,
        status: 400,
        field: "limit",
        error: "limit must be an integer between 1 and 100,000",
      };
    }
    result.limit = body.limit;
  }

  if (body.windowSizeMs !== undefined) {
    if (!isIntegerInRange(body.windowSizeMs, 100, 3600000)) {
      return {
        ok: false,
        status: 400,
        field: "windowSizeMs",
        error: "windowSizeMs must be an integer between 100 and 3,600,000 ms",
      };
    }
    result.windowSizeMs = body.windowSizeMs;
  }

  if (body.refillRatePerSec !== undefined) {
    if (!isNumberInRange(body.refillRatePerSec, 0.01, 100000)) {
      return {
        ok: false,
        status: 400,
        field: "refillRatePerSec",
        error: "refillRatePerSec must be a positive number between 0.01 and 100,000",
      };
    }
    result.refillRatePerSec = body.refillRatePerSec;
  }

  if (body.leakRatePerSec !== undefined) {
    if (!isNumberInRange(body.leakRatePerSec, 0.01, 100000)) {
      return {
        ok: false,
        status: 400,
        field: "leakRatePerSec",
        error: "leakRatePerSec must be a positive number between 0.01 and 100,000",
      };
    }
    result.leakRatePerSec = body.leakRatePerSec;
  }

  return { ok: true, data: result };
}

export interface StartSimulatorInput {
  scenario?: ScenarioName;
  pattern?: TrafficPattern;
  targetRps?: number;
  clientCount?: number;
  seed?: number;
  route?: string;
  cost?: number;
  durationMs?: number;
  burstMultiplier?: number;
  burstDurationMs?: number;
  burstPeriodMs?: number;
  rampDurationMs?: number;
  windowSizeMs?: number;
  minRps?: number;
  maxRps?: number;
}

export function validateStartSimulator(body: any): ValidationResult<StartSimulatorInput> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "Request body must be a JSON object" };
  }

  const result: StartSimulatorInput = {};

  if (body.scenario !== undefined && body.scenario !== "custom") {
    if (typeof body.scenario !== "string" || !SUPPORTED_PRESETS.includes(body.scenario as ScenarioName)) {
      return {
        ok: false,
        status: 400,
        field: "scenario",
        error: `Unknown scenario: '${body.scenario}'. Supported: ${SUPPORTED_PRESETS.join(", ")}`,
      };
    }
    result.scenario = body.scenario as ScenarioName;
  }

  if (body.pattern !== undefined) {
    if (typeof body.pattern !== "string" || !SUPPORTED_PATTERNS.includes(body.pattern as TrafficPattern)) {
      return {
        ok: false,
        status: 400,
        field: "pattern",
        error: `Invalid pattern: '${body.pattern}'. Supported patterns: ${SUPPORTED_PATTERNS.join(", ")}`,
      };
    }
    result.pattern = body.pattern as TrafficPattern;
  }

  if (body.targetRps !== undefined) {
    if (!isNumberInRange(body.targetRps, 1, 10000)) {
      return {
        ok: false,
        status: 400,
        field: "targetRps",
        error: "targetRps must be a number between 1 and 10,000 req/s",
      };
    }
    result.targetRps = body.targetRps;
  }

  if (body.clientCount !== undefined) {
    if (!isIntegerInRange(body.clientCount, 1, 10000)) {
      return {
        ok: false,
        status: 400,
        field: "clientCount",
        error: "clientCount must be an integer between 1 and 10,000",
      };
    }
    result.clientCount = body.clientCount;
  }

  if (body.cost !== undefined) {
    if (!isIntegerInRange(body.cost, 1, 1000)) {
      return {
        ok: false,
        status: 400,
        field: "cost",
        error: "cost must be an integer between 1 and 1,000",
      };
    }
    result.cost = body.cost;
  }

  if (body.durationMs !== undefined) {
    if (!isIntegerInRange(body.durationMs, 0, 3600000)) {
      return {
        ok: false,
        status: 400,
        field: "durationMs",
        error: "durationMs must be an integer between 0 and 3,600,000 ms",
      };
    }
    result.durationMs = body.durationMs;
  }

  if (body.seed !== undefined) {
    if (!isIntegerInRange(body.seed, 0, 2147483647)) {
      return {
        ok: false,
        status: 400,
        field: "seed",
        error: "seed must be an integer between 0 and 2,147,483,647",
      };
    }
    result.seed = body.seed;
  }

  if (body.route !== undefined) {
    if (typeof body.route !== "string" || !SUPPORTED_ROUTES.includes(body.route as any)) {
      return {
        ok: false,
        status: 400,
        field: "route",
        error: `Invalid worker route: '${body.route}'. Supported: ${SUPPORTED_ROUTES.join(", ")}`,
      };
    }
    result.route = body.route;
  }

  if (body.burstMultiplier !== undefined) {
    if (!isNumberInRange(body.burstMultiplier, 1, 50)) {
      return {
        ok: false,
        status: 400,
        field: "burstMultiplier",
        error: "burstMultiplier must be a number between 1 and 50",
      };
    }
    result.burstMultiplier = body.burstMultiplier;
  }

  if (body.burstDurationMs !== undefined) {
    if (!isIntegerInRange(body.burstDurationMs, 1, 3600000)) {
      return {
        ok: false,
        status: 400,
        field: "burstDurationMs",
        error: "burstDurationMs must be an integer between 1 and 3,600,000 ms",
      };
    }
    result.burstDurationMs = body.burstDurationMs;
  }

  if (body.burstPeriodMs !== undefined) {
    if (!isIntegerInRange(body.burstPeriodMs, 1, 3600000)) {
      return {
        ok: false,
        status: 400,
        field: "burstPeriodMs",
        error: "burstPeriodMs must be an integer between 1 and 3,600,000 ms",
      };
    }
    result.burstPeriodMs = body.burstPeriodMs;
  }

  if (body.rampDurationMs !== undefined) {
    if (!isIntegerInRange(body.rampDurationMs, 1, 3600000)) {
      return {
        ok: false,
        status: 400,
        field: "rampDurationMs",
        error: "rampDurationMs must be an integer between 1 and 3,600,000 ms",
      };
    }
    result.rampDurationMs = body.rampDurationMs;
  }

  if (body.windowSizeMs !== undefined) {
    if (!isIntegerInRange(body.windowSizeMs, 100, 3600000)) {
      return {
        ok: false,
        status: 400,
        field: "windowSizeMs",
        error: "windowSizeMs must be an integer between 100 and 3,600,000 ms",
      };
    }
    result.windowSizeMs = body.windowSizeMs;
  }

  if (body.minRps !== undefined) {
    if (!isNumberInRange(body.minRps, 0, 10000)) {
      return {
        ok: false,
        status: 400,
        field: "minRps",
        error: "minRps must be a number between 0 and 10,000 req/s",
      };
    }
    result.minRps = body.minRps;
  }

  if (body.maxRps !== undefined) {
    if (!isNumberInRange(body.maxRps, 1, 10000)) {
      return {
        ok: false,
        status: 400,
        field: "maxRps",
        error: "maxRps must be a number between 1 and 10,000 req/s",
      };
    }
    result.maxRps = body.maxRps;
  }

  // Check maximum effective burst rate
  const effRps = result.targetRps ?? 1000;
  const effMultiplier = result.burstMultiplier ?? 1;
  if (effRps * effMultiplier > MAX_EFFECTIVE_BURST_RPS) {
    return {
      ok: false,
      status: 400,
      field: "burstMultiplier",
      error: `Effective burst rate (${effRps * effMultiplier} req/s) exceeds maximum allowed limit (${MAX_EFFECTIVE_BURST_RPS} req/s)`,
    };
  }

  return { ok: true, data: result };
}

export interface CompareInput {
  algoA: AlgorithmType;
  algoB: AlgorithmType;
  scenario: CompareScenario;
  limit: number;
  windowSizeMs: number;
  refillRatePerSec: number;
  leakRatePerSec: number;
}

export function validateCompare(body: any): ValidationResult<CompareInput> {
  const b = body || {};

  const algoA = b.algoA ?? "fixed-window";
  const valA = validateAlgorithm(algoA);
  if (!valA.ok) return valA;

  const algoB = b.algoB ?? "sliding-window-counter";
  const valB = validateAlgorithm(algoB);
  if (!valB.ok) return valB;

  const scenario = b.scenario ?? "window-boundary";
  if (typeof scenario !== "string" || !SUPPORTED_COMPARE_SCENARIOS.includes(scenario as CompareScenario)) {
    return {
      ok: false,
      status: 400,
      field: "scenario",
      error: `Invalid comparison scenario: '${scenario}'. Supported: ${SUPPORTED_COMPARE_SCENARIOS.join(", ")}`,
    };
  }

  const limit = b.limit !== undefined ? b.limit : 100;
  if (!isIntegerInRange(limit, 1, MAX_REPLAY_LIMIT)) {
    return {
      ok: false,
      status: 400,
      field: "limit",
      error: `limit must be an integer between 1 and ${MAX_REPLAY_LIMIT}`,
    };
  }

  const windowSizeMs = b.windowSizeMs !== undefined ? b.windowSizeMs : 60000;
  if (!isIntegerInRange(windowSizeMs, 100, 3600000)) {
    return {
      ok: false,
      status: 400,
      field: "windowSizeMs",
      error: "windowSizeMs must be an integer between 100 and 3,600,000 ms",
    };
  }

  const refillRatePerSec = b.refillRatePerSec !== undefined ? b.refillRatePerSec : 10;
  if (!isNumberInRange(refillRatePerSec, 0.01, 100000)) {
    return {
      ok: false,
      status: 400,
      field: "refillRatePerSec",
      error: "refillRatePerSec must be a positive number between 0.01 and 100,000",
    };
  }

  const leakRatePerSec = b.leakRatePerSec !== undefined ? b.leakRatePerSec : 10;
  if (!isNumberInRange(leakRatePerSec, 0.01, 100000)) {
    return {
      ok: false,
      status: 400,
      field: "leakRatePerSec",
      error: "leakRatePerSec must be a positive number between 0.01 and 100,000",
    };
  }

  return {
    ok: true,
    data: {
      algoA: valA.data,
      algoB: valB.data,
      scenario: scenario as CompareScenario,
      limit,
      windowSizeMs,
      refillRatePerSec,
      leakRatePerSec,
    },
  };
}
