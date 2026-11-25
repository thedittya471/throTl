"useStrictMode";
"use client";

import React from "react";
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Sliders,
  Layers,
  Zap,
  KeyRound,
  Search,
  FileUp,
  Flame,
  ArrowRight,
  Activity,
} from "lucide-react";

export type AlgorithmType =
  | "fixed-window"
  | "sliding-log"
  | "sliding-window-counter"
  | "token-bucket"
  | "leaky-bucket";

export type LimiterMode = "per-instance" | "shared";

export type ScenarioPreset =
  | "custom"
  | "login-brute-force"
  | "search-spike"
  | "payment-retries"
  | "file-uploads";

export type TrafficPattern =
  | "steady"
  | "burst"
  | "ramp-up"
  | "sawtooth"
  | "window-boundary"
  | "heavy-client";

interface ControlPanelProps {
  algorithm: AlgorithmType;
  onAlgorithmChange: (algo: AlgorithmType) => void;
  mode: LimiterMode;
  onModeChange: (mode: LimiterMode) => void;
  scenario: ScenarioPreset;
  onScenarioChange: (scenario: ScenarioPreset) => void;
  pattern: TrafficPattern;
  onPatternChange: (pattern: TrafficPattern) => void;
  targetRps: number;
  onTargetRpsChange: (rps: number) => void;
  clientCount: number;
  onClientCountChange: (clients: number) => void;
  limit: number;
  onLimitChange: (limit: number) => void;
  windowSizeMs: number;
  onWindowSizeChange: (windowMs: number) => void;
  isRunning: boolean;
  isPaused: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onReset: () => void;
  stats?: {
    totalEmitted: number;
    currentRps: number;
    elapsedMs: number;
  } | null;
}

const ALGORITHMS: {
  id: AlgorithmType;
  index: string;
  name: string;
  complexity: string;
  tag: string;
  description: string;
}[] = [
  {
    id: "fixed-window",
    index: "01",
    name: "Fixed Window",
    complexity: "O(1) TIME",
    tag: "Boundary Burst Risk",
    description: "Counter resets at fixed epoch edges. Vulnerable to 2x boundary spike over-admission.",
  },
  {
    id: "sliding-log",
    index: "02",
    name: "Sliding Log",
    complexity: "O(N) MEMORY",
    tag: "100% Boundary Precision",
    description: "Stores timestamps in rolling memory deque. Strict zero boundary burst vulnerability.",
  },
  {
    id: "sliding-window-counter",
    index: "03",
    name: "Sliding Counter",
    complexity: "O(1) WEIGHTED",
    tag: "Cloudflare / Akamai Std",
    description: "Interpolates previous window overlap. Smoothes bursts with minimal memory footprint.",
  },
  {
    id: "token-bucket",
    index: "04",
    name: "Token Bucket",
    complexity: "CONTINUOUS",
    tag: "Burst Capacity Enabled",
    description: "Refills tokens at continuous rate. Permits instantaneous bursts up to max capacity.",
  },
  {
    id: "leaky-bucket",
    index: "05",
    name: "Leaky Bucket",
    complexity: "TRAFFIC SHAPING",
    tag: "Smooth Outflow",
    description: "FIFO buffer leaking at constant rate. Enforces strict downstream pacing.",
  },
];

const PRESETS: { id: ScenarioPreset; index: string; name: string; icon: any; detail: string }[] = [
  { id: "custom", index: "P0", name: "Manual Synthesizer", icon: Sliders, detail: "Configurable rate & distribution" },
  { id: "login-brute-force", index: "P1", name: "Login Brute Force", icon: KeyRound, detail: "50 req/s to /api/login (1 IP)" },
  { id: "search-spike", index: "P2", name: "Search Traffic Surge", icon: Search, detail: "500 concurrent clients surging" },
  { id: "payment-retries", index: "P3", name: "Webhook Retries", icon: Flame, detail: "200 retries hitting /api/pay" },
  { id: "file-uploads", index: "P4", name: "Heavy File Uploads", icon: FileUp, detail: "Paced bandwidth (cost: 5)" },
];

const SCENARIO_RECOMMENDATIONS: Record<
  ScenarioPreset,
  { algo: AlgorithmType; label: string; reason: string } | null
> = {
  custom: null,
  "login-brute-force": {
    algo: "leaky-bucket",
    label: "Leaky Bucket",
    reason: "Strict pacing prevents dictionary attacks from overloading auth endpoints.",
  },
  "search-spike": {
    algo: "token-bucket",
    label: "Token Bucket",
    reason: "Absorbs sudden surges up to burst capacity without unnecessary 429 drops.",
  },
  "payment-retries": {
    algo: "sliding-window-counter",
    label: "Sliding Counter",
    reason: "Smooths exponential webhook retries with weighted window interpolation.",
  },
  "file-uploads": {
    algo: "leaky-bucket",
    label: "Leaky Bucket",
    reason: "Constant outflow pacing protects upstream storage from saturated bandwidth.",
  },
};

export function ControlPanel({
  algorithm,
  onAlgorithmChange,
  mode,
  onModeChange,
  scenario,
  onScenarioChange,
  pattern,
  onPatternChange,
  targetRps,
  onTargetRpsChange,
  clientCount,
  onClientCountChange,
  isRunning,
  isPaused,
  onStart,
  onPause,
  onResume,
  onStop,
  onReset,
  stats,
}: ControlPanelProps) {
  return (
    <div className="space-y-6">
      {/* SECTION 01: Algorithm Selection Cards */}
      <div data-tour="algorithm-selection">
        <div className="mb-2.5 flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-studio-orange font-bold">[ 01 ]</span>
            <span className="font-semibold uppercase tracking-wider text-white">
              Mathematical Engine Selection
            </span>
          </div>
          <span className="text-carbon-500 uppercase tracking-widest hidden sm:inline">
            5 In-Memory & Redis Lua Engines
          </span>
        </div>

        {/* Mobile Algorithm Selector (< sm) */}
        <div className="block sm:hidden mb-3">
          <label htmlFor="mobile-algo-select" className="sr-only">
            Select Rate Limiting Algorithm
          </label>
          <select
            id="mobile-algo-select"
            value={algorithm}
            onChange={(e) => onAlgorithmChange(e.target.value as AlgorithmType)}
            className="w-full border border-white/[0.08] bg-carbon-950 px-3 py-2 font-mono text-xs text-white outline-none focus:border-studio-orange"
            aria-label="Select rate limiting algorithm"
          >
            {ALGORITHMS.map((algo) => (
              <option key={algo.id} value={algo.id}>
                [{algo.index}] {algo.name} — {algo.complexity}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {ALGORITHMS.map((algo) => {
            const isSelected = algorithm === algo.id;
            return (
              <button
                key={algo.id}
                onClick={() => onAlgorithmChange(algo.id)}
                aria-label={`Select algorithm: ${algo.name}`}
                aria-pressed={isSelected}
                className={`corner-crosshair group relative flex flex-col justify-between p-4 text-left transition-all duration-150 ${
                  isSelected
                    ? "studio-card-active border-studio-orange/80 shadow-lg shadow-studio-orange/10"
                    : "studio-card hover:border-white/20"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className={isSelected ? "text-studio-orange font-bold" : "text-carbon-500"}>
                      [{algo.index}]
                    </span>
                    <span
                      className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                        isSelected
                          ? "bg-studio-orange text-carbon-950 font-black"
                          : "border border-white/[0.08] text-carbon-400"
                      }`}
                    >
                      {algo.complexity}
                    </span>
                  </div>

                  <h3 className="mt-2.5 font-sans text-sm font-bold tracking-tight text-white group-hover:text-studio-orange transition-colors">
                    {algo.name}
                  </h3>

                  <p className="mt-1 font-mono text-[10px] text-carbon-400 uppercase tracking-wide">
                    {algo.tag}
                  </p>
                </div>

                <p className="mt-3 text-[11px] leading-relaxed text-carbon-400 border-t border-white/[0.05] pt-2">
                  {algo.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* SECTION 02: Cluster Topology & Traffic Controls */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Coordination Topology */}
        <div data-tour="cluster-topology" className="studio-card corner-crosshair p-5 flex flex-col justify-between">
          <div>
            <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="text-studio-orange font-bold">[ 02 ]</span>
                <span className="font-semibold uppercase tracking-wider text-white">Cluster Topology</span>
              </div>
              <span className="text-carbon-500">:4000 GW</span>
            </div>

            <div className="grid grid-cols-2 gap-2 p-1 border border-white/[0.08] bg-carbon-950">
              <button
                onClick={() => onModeChange("per-instance")}
                aria-label="Set mode to Per-Instance local memory"
                aria-pressed={mode === "per-instance"}
                className={`py-2 px-3 font-mono text-[11px] text-left transition-all ${
                  mode === "per-instance"
                    ? "bg-carbon-800 text-white border-l-2 border-amber-400 shadow-sm"
                    : "text-carbon-400 hover:text-white"
                }`}
              >
                <div className="font-bold">PER-INSTANCE</div>
                <div className="text-[9px] text-amber-400/90 font-sans mt-0.5">3x Over-Admission Risk</div>
              </button>

              <button
                onClick={() => onModeChange("shared")}
                aria-label="Set mode to Shared Redis atomic Lua"
                aria-pressed={mode === "shared"}
                className={`py-2 px-3 font-mono text-[11px] text-left transition-all ${
                  mode === "shared"
                    ? "bg-carbon-800 text-white border-l-2 border-studio-orange shadow-sm"
                    : "text-carbon-400 hover:text-white"
                }`}
              >
                <div className="font-bold">SHARED REDIS</div>
                <div className="text-[9px] text-studio-orange font-sans mt-0.5">Strict Lua Coordination</div>
              </button>
            </div>

            <div className="mt-3 border border-white/[0.06] bg-carbon-950/70 p-3 font-mono text-[10px] leading-relaxed text-carbon-400">
              {mode === "per-instance" ? (
                <div>
                  <span className="text-amber-400 font-bold">// LOCAL MEMORY: </span>
                  Instances track quota in independent process memory. A 100 req limit across 3 instances permits 300 total requests before 429 triggers.
                </div>
              ) : (
                <div>
                  <span className="text-studio-orange font-bold">// ATOMIC EVALSHA: </span>
                  All cluster nodes execute single-roundtrip Lua scripts in Redis. Strict cluster-wide cap of exactly 100 requests enforced.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-white/[0.05] pt-2 font-mono text-[10px] text-carbon-500">
            <span>DISPATCH: ROUND-ROBIN</span>
            <span>NODES: :4001 :4002 :4003</span>
          </div>
        </div>

        {/* Preset Scenarios */}
        <div data-tour="preset-scenarios" className="studio-card corner-crosshair p-5 flex flex-col justify-between">
          <div>
            <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="text-studio-orange font-bold">[ 03 ]</span>
                <span className="font-semibold uppercase tracking-wider text-white">Preset Scenarios</span>
              </div>
              <span className="text-carbon-500">SEEDED REPLAY</span>
            </div>

            <div className="space-y-1.5">
              {PRESETS.map((p) => {
                const Icon = p.icon;
                const isSelected = scenario === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => onScenarioChange(p.id)}
                    aria-label={`Select preset: ${p.name}`}
                    aria-pressed={isSelected}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left transition-all ${
                      isSelected
                        ? "border border-studio-orange/60 bg-studio-orangeSubtle text-white"
                        : "border border-white/[0.05] bg-carbon-950/50 text-carbon-300 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-[10px] text-carbon-500">
                        {p.index}
                      </span>
                      <Icon className={`h-3.5 w-3.5 ${isSelected ? "text-studio-orange" : "text-carbon-400"}`} />
                      <div>
                        <div className="font-sans text-xs font-semibold">{p.name}</div>
                        <div className="font-mono text-[10px] text-carbon-400">{p.detail}</div>
                      </div>
                    </div>
                    {isSelected && (
                      <span className="font-mono text-[9px] font-black text-studio-orange">
                        [ON]
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Smart Scenario Engine Recommendation Assistant */}
            {scenario !== "custom" && SCENARIO_RECOMMENDATIONS[scenario] && (
              <div className="mt-3 border border-studio-orange/30 bg-studio-orange/5 p-2.5 font-mono text-[10px] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-studio-orange font-bold uppercase tracking-wider">
                    RECOMMENDED ENGINE:
                  </span>
                  {algorithm === SCENARIO_RECOMMENDATIONS[scenario]!.algo ? (
                    <span className="text-emerald-400 font-bold">[ACTIVE]</span>
                  ) : (
                    <button
                      onClick={() => onAlgorithmChange(SCENARIO_RECOMMENDATIONS[scenario]!.algo)}
                      className="bg-studio-orange text-carbon-950 px-2 py-0.5 font-black uppercase tracking-wider hover:bg-studio-orangeHover transition"
                    >
                      SWITCH TO {SCENARIO_RECOMMENDATIONS[scenario]!.label.toUpperCase()}
                    </button>
                  )}
                </div>
                <p className="text-carbon-300 font-sans text-[11px] leading-tight">
                  {SCENARIO_RECOMMENDATIONS[scenario]!.reason}
                </p>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-2 font-mono text-[10px] text-carbon-500">
            <span>DETERMINISTIC SEED: 1337</span>
            <span>REPLAYABLE: YES</span>
          </div>
        </div>

        {/* Traffic Generator Parameters */}
        <div data-tour="traffic-params" className="studio-card corner-crosshair p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="text-studio-orange font-bold">[ 04 ]</span>
                <span className="font-semibold uppercase tracking-wider text-white">Traffic Parameters</span>
              </div>
              <span className="font-mono text-studio-orange font-bold">{targetRps} REQ/S</span>
            </div>

            {/* Target RPS */}
            <div className="space-y-1.5">
              <div className="flex justify-between font-mono text-[10px] text-carbon-400 uppercase">
                <span>Target Rate</span>
                <span className="font-bold text-white">{targetRps} req/s</span>
              </div>
              <input
                type="range"
                min={1}
                max={1000}
                value={targetRps}
                onChange={(e) => onTargetRpsChange(Number(e.target.value))}
                className="w-full cursor-pointer"
                aria-label="Target request rate in requests per second"
              />
              <div className="flex justify-between gap-1 pt-1">
                {[50, 200, 500, 1000].map((v) => (
                  <button
                    key={v}
                    onClick={() => onTargetRpsChange(v)}
                    className={`flex-1 py-1 font-mono text-[10px] border transition ${
                      targetRps === v
                        ? "border-studio-orange bg-studio-orange text-carbon-950 font-bold"
                        : "border-white/[0.06] bg-carbon-950 text-carbon-400 hover:text-white"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Virtual Clients */}
            <div className="mt-4 space-y-1.5">
              <div className="flex justify-between font-mono text-[10px] text-carbon-400 uppercase">
                <span>Client Pool</span>
                <span className="font-bold text-white">{clientCount} clients</span>
              </div>
              <input
                type="range"
                min={1}
                max={1000}
                value={clientCount}
                onChange={(e) => onClientCountChange(Number(e.target.value))}
                className="w-full cursor-pointer"
                aria-label="Virtual client pool size"
              />
              <div className="flex justify-between gap-1 pt-1">
                {[1, 10, 100, 500, 1000].map((v) => (
                  <button
                    key={v}
                    onClick={() => onClientCountChange(v)}
                    className={`flex-1 py-1 font-mono text-[10px] border transition ${
                      clientCount === v
                        ? "border-studio-orange bg-studio-orange text-carbon-950 font-bold"
                        : "border-white/[0.06] bg-carbon-950 text-carbon-400 hover:text-white"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Pattern Shape */}
            <div className="mt-4">
              <label htmlFor="pattern-select" className="block font-mono text-[10px] text-carbon-400 uppercase mb-1">
                Arrival Distribution
              </label>
              <select
                id="pattern-select"
                value={pattern}
                onChange={(e) => onPatternChange(e.target.value as TrafficPattern)}
                className="w-full border border-white/[0.08] bg-carbon-950 px-3 py-1.5 font-mono text-[11px] text-white outline-none focus:border-studio-orange"
                aria-label="Traffic arrival distribution pattern"
              >
                <option value="steady">STEADY (Uniform Arrival)</option>
                <option value="burst">BURST (Multiplier Surges)</option>
                <option value="ramp-up">RAMP-UP (Linear Scaling)</option>
                <option value="sawtooth">SAWTOOTH (Cyclical Peaks)</option>
                <option value="window-boundary">WINDOW BOUNDARY ATTACK</option>
                <option value="heavy-client">HEAVY CLIENT (80% Abuser)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 03: Execution Bar & Telemetry */}
      <div data-tour="execution-bar" className="studio-card corner-crosshair p-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {!isRunning ? (
            <button
              onClick={onStart}
              className="btn-studio-primary flex items-center gap-2 px-6 py-2.5 font-mono text-xs uppercase tracking-wider group"
            >
              <Play className="h-3.5 w-3.5 fill-carbon-950" />
              <span>RUN SIMULATOR</span>
              <kbd className="hidden sm:inline text-[9px] bg-black/20 text-carbon-950 px-1.5 py-0.5 rounded font-mono font-bold">
                SPACE
              </kbd>
            </button>
          ) : isPaused ? (
            <button
              onClick={onResume}
              className="btn-studio-primary flex items-center gap-2 px-6 py-2.5 font-mono text-xs uppercase tracking-wider"
            >
              <Play className="h-3.5 w-3.5 fill-carbon-950" />
              <span>RESUME</span>
              <kbd className="hidden sm:inline text-[9px] bg-black/20 text-carbon-950 px-1.5 py-0.5 rounded font-mono font-bold">
                SPACE
              </kbd>
            </button>
          ) : (
            <button
              onClick={onPause}
              className="flex items-center gap-2 border border-amber-400/50 bg-amber-400/10 px-6 py-2.5 font-mono text-xs font-bold text-amber-300 uppercase tracking-wider hover:bg-amber-400/20"
            >
              <Pause className="h-3.5 w-3.5 fill-amber-300" />
              <span>PAUSE</span>
              <kbd className="hidden sm:inline text-[9px] bg-amber-400/20 text-amber-300 px-1.5 py-0.5 rounded font-mono">
                SPACE
              </kbd>
            </button>
          )}

          <button
            onClick={onStop}
            disabled={!isRunning}
            className="flex items-center gap-2 border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 font-mono text-xs font-bold text-rose-300 uppercase tracking-wider hover:bg-rose-500/20 disabled:opacity-30 disabled:pointer-events-none"
          >
            <Square className="h-3.5 w-3.5 fill-rose-300" />
            <span>HALT</span>
            <kbd className="hidden sm:inline text-[9px] bg-rose-500/20 text-rose-300 px-1 py-0.5 rounded font-mono">
              ESC
            </kbd>
          </button>

          <button
            onClick={onReset}
            className="flex items-center gap-2 border border-white/[0.08] bg-carbon-900 px-4 py-2.5 font-mono text-xs font-semibold text-carbon-300 uppercase tracking-wider hover:border-white/20 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>RESET CLUSTER</span>
            <kbd className="hidden sm:inline text-[9px] bg-white/10 text-carbon-400 px-1.5 py-0.5 rounded font-mono">
              R
            </kbd>
          </button>
        </div>

        {/* Real-time Status Readout */}
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between sm:justify-start gap-3 sm:gap-4 border border-white/[0.08] bg-carbon-950 px-3 sm:px-4 py-2 font-mono text-[11px]">
          <div>
            <div className="text-[9px] text-carbon-500 uppercase tracking-wider">Engine State</div>
            <div className="flex items-center gap-1.5 font-bold mt-0.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isRunning
                    ? isPaused
                      ? "bg-amber-400"
                      : "bg-studio-orange animate-pulse shadow-[0_0_6px_rgba(255,84,0,0.9)]"
                    : "bg-carbon-600"
                }`}
              />
              <span
                className={
                  isRunning
                    ? isPaused
                      ? "text-amber-300"
                      : "text-studio-orange"
                    : "text-carbon-400"
                }
              >
                {isRunning ? (isPaused ? "PAUSED" : "ACTIVE") : "IDLE"}
              </span>
            </div>
          </div>

          <div className="h-6 w-px bg-white/[0.08]" />

          <div>
            <div className="text-[9px] text-carbon-500 uppercase tracking-wider">Emitted</div>
            <div className="font-bold text-white mt-0.5">
              {stats?.totalEmitted?.toLocaleString() || 0} REQS
            </div>
          </div>

          <div className="h-6 w-px bg-white/[0.08]" />

          <div>
            <div className="text-[9px] text-carbon-500 uppercase tracking-wider">Elapsed</div>
            <div className="font-bold text-studio-orange mt-0.5">
              {stats?.elapsedMs ? `${(stats.elapsedMs / 1000).toFixed(1)}s` : "0.0s"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
