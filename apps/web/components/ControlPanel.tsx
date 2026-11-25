"useStrictMode";
"use client";

import React, { useState } from "react";
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Sliders,
  Layers,
  Cpu,
  Zap,
  TrendingUp,
  AlertTriangle,
  FileUp,
  Search,
  KeyRound,
  ShieldAlert,
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
  name: string;
  badge: string;
  color: string;
  description: string;
}[] = [
  {
    id: "fixed-window",
    name: "Fixed Window",
    badge: "O(1) Boundary Burst",
    color: "from-cyan-500/20 to-blue-500/10 border-cyan-500/40 text-cyan-300",
    description: "Resets counter at fixed boundaries; susceptible to 2x boundary bursts.",
  },
  {
    id: "sliding-log",
    name: "Sliding Log",
    badge: "O(N) Precision Deque",
    color: "from-purple-500/20 to-indigo-500/10 border-purple-500/40 text-purple-300",
    description: "Stores timestamps in rolling deque; 100% exact boundary enforcement.",
  },
  {
    id: "sliding-window-counter",
    name: "Sliding Counter",
    badge: "O(1) Smooth Interpolation",
    color: "from-emerald-500/20 to-teal-500/10 border-emerald-500/40 text-emerald-300",
    description: "Weighted overlap between current and previous window buckets.",
  },
  {
    id: "token-bucket",
    name: "Token Bucket",
    badge: "Continuous Refill",
    color: "from-amber-500/20 to-yellow-500/10 border-amber-500/40 text-amber-300",
    description: "Refills tokens smoothly; supports bursts up to bucket capacity.",
  },
  {
    id: "leaky-bucket",
    name: "Leaky Bucket",
    badge: "Traffic Shaping Queue",
    color: "from-rose-500/20 to-pink-500/10 border-rose-500/40 text-rose-300",
    description: "Continuous outflow rate; converts bursts into smooth constant stream.",
  },
];

const PRESETS: { id: ScenarioPreset; name: string; icon: any; summary: string }[] = [
  { id: "custom", name: "Custom Run", icon: Sliders, summary: "Manual traffic shape & parameters" },
  { id: "login-brute-force", name: "Login Brute Force", icon: KeyRound, summary: "50 req/s to /api/login from 1 IP" },
  { id: "search-spike", name: "Search Spike", icon: Search, summary: "500 clients surging /api/search" },
  { id: "payment-retries", name: "Payment Retries", icon: Zap, summary: "200 webhook retries hitting /api/pay" },
  { id: "file-uploads", name: "File Uploads", icon: FileUp, summary: "Heavy payloads (cost: 5) to /api/upload" },
];

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
  limit,
  onLimitChange,
  windowSizeMs,
  onWindowSizeChange,
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
      {/* 1. Algorithm Selection Cards */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-200">
            <Cpu className="h-4 w-4 text-cyan-400" />
            RATE LIMITING ALGORITHM
          </label>
          <span className="text-xs text-slate-400">Select active mathematical engine</span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {ALGORITHMS.map((algo) => {
            const isSelected = algorithm === algo.id;
            return (
              <button
                key={algo.id}
                onClick={() => onAlgorithmChange(algo.id)}
                className={`group relative flex flex-col justify-between rounded-xl p-3.5 text-left transition-all duration-200 ${
                  isSelected
                    ? `bg-gradient-to-b ${algo.color} border shadow-lg shadow-cyan-950/50 ring-1 ring-cyan-400/50`
                    : "border border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white group-hover:text-cyan-300">
                      {algo.name}
                    </span>
                    {isSelected && (
                      <span className="flex h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.9)]" />
                    )}
                  </div>
                  <span className="mt-1 inline-block text-[10px] font-mono font-medium text-slate-400">
                    {algo.badge}
                  </span>
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
                  {algo.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Controls Grid: Mode, Preset Scenarios, Traffic Parameters */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Mode & Coordination Architecture */}
        <div className="cockpit-panel rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Layers className="h-4 w-4 text-cyan-400" />
              CLUSTER COORDINATION
            </label>
            <span className="text-xs font-mono text-slate-400">3 Instances</span>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950/80 p-1.5 border border-slate-800">
            <button
              onClick={() => onModeChange("per-instance")}
              className={`rounded-lg py-2.5 px-3 text-xs font-medium transition-all ${
                mode === "per-instance"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <div className="font-semibold">Per-Instance</div>
              <div className="text-[10px] opacity-75">Local Memory (Over-admission)</div>
            </button>

            <button
              onClick={() => onModeChange("shared")}
              className={`rounded-lg py-2.5 px-3 text-xs font-medium transition-all ${
                mode === "shared"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <div className="font-semibold">Shared State</div>
              <div className="text-[10px] opacity-75">Redis Atomic Lua Scripts</div>
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-slate-800/80 bg-slate-950/50 p-3 text-xs leading-relaxed text-slate-400">
            {mode === "per-instance" ? (
              <p>
                <strong className="text-amber-300 font-medium">Independent Quotas:</strong> Each of the 3 cluster instances tracks limits locally. 300 requests distributed 3-ways allow ~300 requests instead of 100!
              </p>
            ) : (
              <p>
                <strong className="text-emerald-300 font-medium">Atomic Redis Coordination:</strong> All 3 instances synchronize state via atomic EVALSHA Lua scripts. Cluster-wide limit strictly capped at 100 requests.
              </p>
            )}
          </div>
        </div>

        {/* Preset Scenarios */}
        <div className="cockpit-panel rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Zap className="h-4 w-4 text-cyan-400" />
              PRESET SCENARIOS
            </label>
            <span className="text-xs text-slate-400">Deterministic Seeds</span>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {PRESETS.map((p) => {
              const Icon = p.icon;
              const isSelected = scenario === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => onScenarioChange(p.id)}
                  className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-xs transition-all ${
                    isSelected
                      ? "border border-cyan-500/50 bg-cyan-500/10 text-cyan-200 shadow-sm"
                      : "border border-slate-800/80 bg-slate-950/40 text-slate-300 hover:border-slate-700 hover:bg-slate-900/60"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`h-4 w-4 ${isSelected ? "text-cyan-400" : "text-slate-400"}`} />
                    <div>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-[10px] text-slate-400">{p.summary}</div>
                    </div>
                  </div>
                  {isSelected && (
                    <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-mono text-cyan-300">
                      ACTIVE
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rate Parameters & Sliders */}
        <div className="cockpit-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Sliders className="h-4 w-4 text-cyan-400" />
              TRAFFIC GENERATOR
            </label>
            <span className="font-mono text-xs text-cyan-400 font-bold">{targetRps} REQ/S</span>
          </div>

          {/* Target RPS Slider */}
          <div>
            <div className="mb-1.5 flex justify-between text-xs text-slate-400">
              <span>Target RPS</span>
              <span className="font-mono font-semibold text-white">{targetRps}</span>
            </div>
            <input
              type="range"
              min={1}
              max={1000}
              value={targetRps}
              onChange={(e) => onTargetRpsChange(Number(e.target.value))}
              className="w-full cursor-pointer"
            />
            <div className="mt-1 flex justify-between gap-1">
              {[50, 200, 500, 1000].map((val) => (
                <button
                  key={val}
                  onClick={() => onTargetRpsChange(val)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-mono transition ${
                    targetRps === val
                      ? "bg-cyan-500 text-slate-950 font-bold"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          {/* Virtual Clients Slider */}
          <div>
            <div className="mb-1.5 flex justify-between text-xs text-slate-400">
              <span>Virtual Clients</span>
              <span className="font-mono font-semibold text-white">{clientCount}</span>
            </div>
            <input
              type="range"
              min={1}
              max={1000}
              value={clientCount}
              onChange={(e) => onClientCountChange(Number(e.target.value))}
              className="w-full cursor-pointer"
            />
            <div className="mt-1 flex justify-between gap-1">
              {[1, 10, 100, 500, 1000].map((val) => (
                <button
                  key={val}
                  onClick={() => onClientCountChange(val)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-mono transition ${
                    clientCount === val
                      ? "bg-cyan-500 text-slate-950 font-bold"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          {/* Traffic Pattern Selection */}
          <div>
            <label className="mb-1 block text-xs text-slate-400">Traffic Pattern Shape</label>
            <select
              value={pattern}
              onChange={(e) => onPatternChange(e.target.value as TrafficPattern)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
            >
              <option value="steady">Steady (Uniform Arrival)</option>
              <option value="burst">Burst (Multiplier Spikes)</option>
              <option value="ramp-up">Ramp-Up (Linear Scaling)</option>
              <option value="sawtooth">Sawtooth (Cyclical Peaks)</option>
              <option value="window-boundary">Window Boundary Burst Attack</option>
              <option value="heavy-client">Heavy Client (80% Abuser)</option>
            </select>
          </div>
        </div>
      </div>

      {/* 3. Action Control Bar & Simulator Status */}
      <div className="cockpit-panel rounded-2xl p-4 sm:p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          {!isRunning ? (
            <button
              onClick={onStart}
              className="relative flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition-all duration-200 hover:from-emerald-400 hover:to-teal-500 active:scale-95"
            >
              <Play className="h-4 w-4 fill-slate-950" />
              START SIMULATOR
            </button>
          ) : isPaused ? (
            <button
              onClick={onResume}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/25 transition-all duration-200 hover:from-cyan-400 hover:to-blue-500 active:scale-95"
            >
              <Play className="h-4 w-4 fill-slate-950" />
              RESUME
            </button>
          ) : (
            <button
              onClick={onPause}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-600 px-6 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/25 transition-all duration-200 hover:from-amber-400 hover:to-yellow-500 active:scale-95"
            >
              <Pause className="h-4 w-4 fill-slate-950" />
              PAUSE
            </button>
          )}

          <button
            onClick={onStop}
            disabled={!isRunning}
            className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-300 transition-all duration-200 hover:bg-rose-500/20 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Square className="h-4 w-4 fill-rose-400" />
            STOP
          </button>

          <button
            onClick={onReset}
            className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-all duration-200 hover:border-slate-600 hover:bg-slate-700 active:scale-95"
          >
            <RotateCcw className="h-4 w-4" />
            RESET CLUSTER
          </button>
        </div>

        {/* Live Simulator Status Telemetry */}
        <div className="flex items-center gap-4 rounded-xl border border-slate-800/80 bg-slate-950/60 px-4 py-2 text-xs">
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Status</div>
            <div className="flex items-center gap-1.5 font-bold">
              <span
                className={`h-2 w-2 rounded-full ${
                  isRunning
                    ? isPaused
                      ? "bg-amber-400"
                      : "bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.9)]"
                    : "bg-slate-600"
                }`}
              />
              <span
                className={
                  isRunning
                    ? isPaused
                      ? "text-amber-300"
                      : "text-emerald-300"
                    : "text-slate-400"
                }
              >
                {isRunning ? (isPaused ? "PAUSED" : "GENERATING") : "IDLE"}
              </span>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800" />

          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Total Emitted</div>
            <div className="font-mono font-bold text-white">
              {stats?.totalEmitted?.toLocaleString() || 0}
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800" />

          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Elapsed</div>
            <div className="font-mono font-bold text-cyan-400">
              {stats?.elapsedMs ? `${(stats.elapsedMs / 1000).toFixed(1)}s` : "0.0s"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
