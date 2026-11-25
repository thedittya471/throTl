import { TrafficEngine, type TrafficEngineConfig, type TrafficPattern } from "./engine.js";

export type ScenarioName =
  | "login-brute-force"
  | "search-spike"
  | "payment-retries"
  | "file-uploads";

export interface PresetScenario {
  name: ScenarioName;
  description: string;
  route: string;
  pattern: TrafficPattern;
  targetRps: number;
  clientCount: number;
  clientId?: string;
  cost?: number;
  burstMultiplier?: number;
  burstDurationMs?: number;
  burstPeriodMs?: number;
  rampDurationMs?: number;
  minRps?: number;
  maxRps?: number;
  seed: number;
  durationMs?: number;
}

export const PRESET_SCENARIOS: Record<ScenarioName, PresetScenario> = {
  "login-brute-force": {
    name: "login-brute-force",
    description: "50 req/s to /api/login from a single IP",
    route: "/api/login",
    pattern: "steady",
    targetRps: 50,
    clientCount: 1,
    clientId: "client-attacker",
    cost: 1,
    seed: 1337,
  },
  "search-spike": {
    name: "search-spike",
    description: "500 concurrent clients surging /api/search",
    route: "/api/search",
    pattern: "burst",
    targetRps: 500,
    clientCount: 500,
    burstMultiplier: 2,
    burstDurationMs: 2000,
    burstPeriodMs: 8000,
    cost: 1,
    seed: 1337,
  },
  "payment-retries": {
    name: "payment-retries",
    description: "200 webhook retries hitting /api/pay simultaneously",
    route: "/api/pay",
    pattern: "burst",
    targetRps: 200,
    clientCount: 200,
    burstMultiplier: 3,
    burstDurationMs: 1000,
    burstPeriodMs: 5000,
    cost: 1,
    seed: 1337,
  },
  "file-uploads": {
    name: "file-uploads",
    description: "Heavy payloads requiring paced bandwidth",
    route: "/api/upload",
    pattern: "steady",
    targetRps: 50,
    clientCount: 20,
    cost: 5,
    seed: 1337,
  },
};

export function getPresetScenario(name: ScenarioName): PresetScenario {
  const scenario = PRESET_SCENARIOS[name];
  if (!scenario) {
    throw new Error(`Unknown preset scenario: ${name}`);
  }
  return { ...scenario };
}

export function createScenarioEngine(
  name: ScenarioName,
  overrides: Partial<TrafficEngineConfig> = {}
): TrafficEngine {
  const preset = getPresetScenario(name);
  return new TrafficEngine({
    ...preset,
    ...overrides,
  });
}
