"use client";

import React, { useState, useEffect } from "react";
import {
  GitCompare,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Play,
  RotateCcw,
  Clock,
  Layers,
  ArrowRightLeft,
  ChevronRight,
  Shield,
  Activity,
  Sliders,
} from "lucide-react";

export type AlgorithmType =
  | "fixed-window"
  | "sliding-log"
  | "sliding-window-counter"
  | "token-bucket"
  | "leaky-bucket";

export type ScenarioType =
  | "window-boundary"
  | "burst-spike"
  | "heavy-client"
  | "steady-overload";

interface AlgoResult {
  algorithm: AlgorithmType;
  total: number;
  allowed: number;
  rejected: number;
  avgLatencyNs: number;
  internalState: Record<string, any>;
}

interface TimelineBucket {
  bucketIndex: number;
  timeMs: number;
  allowedA: number;
  rejectedA: number;
  allowedB: number;
  rejectedB: number;
}

interface SampleRequest {
  index: number;
  clientId: string;
  timestampMs: number;
  allowedA: boolean;
  allowedB: boolean;
  remainingA: number;
  remainingB: number;
}

interface ComparisonData {
  success: boolean;
  scenario: ScenarioType;
  limit: number;
  windowSizeMs: number;
  totalRequests: number;
  divergence: number;
  boundaryLeakDetected: boolean;
  algoA: AlgoResult;
  algoB: AlgoResult;
  timeline: TimelineBucket[];
  sampleRequests: SampleRequest[];
}

const ALGORITHMS: { id: AlgorithmType; label: string; complexity: string; space: string }[] = [
  { id: "fixed-window", label: "Fixed Window", complexity: "O(1)", space: "O(1)" },
  { id: "sliding-log", label: "Sliding Log", complexity: "O(log N)", space: "O(N)" },
  { id: "sliding-window-counter", label: "Sliding Counter", complexity: "O(1)", space: "O(1)" },
  { id: "token-bucket", label: "Token Bucket", complexity: "O(1)", space: "O(1)" },
  { id: "leaky-bucket", label: "Leaky Bucket", complexity: "O(1)", space: "O(1)" },
];

const SCENARIOS: { id: ScenarioType; label: string; description: string }[] = [
  {
    id: "window-boundary",
    label: "Window Boundary Attack",
    description: "Sends 100 requests right before window ends (t=59.9s) and 100 immediately after (t=60.1s).",
  },
  {
    id: "burst-spike",
    label: "Burst Spike (3x Peak)",
    description: "Simulates sudden 150 request surge concentrated in a 1-second burst interval.",
  },
  {
    id: "heavy-client",
    label: "Monopolizing Client",
    description: "Single aggressive client generates 80% of traffic, starving normal users.",
  },
  {
    id: "steady-overload",
    label: "Sustained 200% Overload",
    description: "Evenly spaced stream pushing 200 requests across a 100-request window.",
  },
];

export function ComparisonMatrix() {
  const [algoA, setAlgoA] = useState<AlgorithmType>("fixed-window");
  const [algoB, setAlgoB] = useState<AlgorithmType>("sliding-window-counter");
  const [scenario, setScenario] = useState<ScenarioType>("window-boundary");
  const [limit, setLimit] = useState<number>(100);
  const [windowSizeMs, setWindowSizeMs] = useState<number>(60000);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"timeline" | "samples">("timeline");

  const runComparison = async (
    overrideA?: AlgorithmType,
    overrideB?: AlgorithmType,
    overrideScenario?: ScenarioType
  ) => {
    setIsLoading(true);
    setError(null);

    const activeA = overrideA || algoA;
    const activeB = overrideB || algoB;
    const activeScenario = overrideScenario || scenario;

    try {
      const resp = await fetch("/api/simulator/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          algoA: activeA,
          algoB: activeB,
          scenario: activeScenario,
          limit,
          windowSizeMs,
        }),
      });

      if (!resp.ok) {
        throw new Error(`Comparison failed with HTTP ${resp.status}`);
      }

      const data: ComparisonData = await resp.json();
      setComparisonData(data);
    } catch (err: any) {
      setError(err.message || "Failed to execute comparison");
    } finally {
      setIsLoading(false);
    }
  };

  // Run initial comparison on mount
  useEffect(() => {
    runComparison();
  }, []);

  const triggerPreset = (presetScenario: ScenarioType, a: AlgorithmType, b: AlgorithmType) => {
    setScenario(presetScenario);
    setAlgoA(a);
    setAlgoB(b);
    runComparison(a, b, presetScenario);
  };

  const getAlgoMeta = (id: AlgorithmType) => {
    return ALGORITHMS.find((a) => a.id === id) || ALGORITHMS[0];
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-full overflow-hidden">
      {/* Control Cockpit Card */}
      <div className="relative border border-white/10 bg-[#0c0c10] p-3.5 sm:p-5 max-w-full">
        <div className="absolute -top-1 -left-1 text-white/30 text-[10px] font-mono leading-none select-none">+</div>
        <div className="absolute -top-1 -right-1 text-white/30 text-[10px] font-mono leading-none select-none">+</div>
        <div className="absolute -bottom-1 -left-1 text-white/30 text-[10px] font-mono leading-none select-none">+</div>
        <div className="absolute -bottom-1 -right-1 text-white/30 text-[10px] font-mono leading-none select-none">+</div>

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-white/5">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="font-mono text-xs text-[#FF5400]">[ 08 ]</span>
            <span className="font-mono text-xs uppercase tracking-widest text-white/50">Comparative Matrix</span>
            <span className="text-white/20">/</span>
            <span className="font-mono text-xs text-white/80">Concurrent Deterministic Replay</span>
          </div>

          {/* Quick Benchmark Presets */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">Presets:</span>
            <button
              onClick={() => triggerPreset("window-boundary", "fixed-window", "sliding-window-counter")}
              aria-label="Preset: Window boundary exploit with 200% leak"
              className={`px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-mono transition-colors border ${
                scenario === "window-boundary" && algoA === "fixed-window" && algoB === "sliding-window-counter"
                  ? "border-[#FF5400] text-[#FF5400] bg-[#FF5400]/10"
                  : "border-white/10 text-white/60 hover:text-white hover:border-white/20 bg-white/5"
              }`}
            >
              Boundary Exploit (200% Leak)
            </button>
            <button
              onClick={() => triggerPreset("burst-spike", "token-bucket", "leaky-bucket")}
              aria-label="Preset: Burst comparison Token vs Leaky"
              className={`px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-mono transition-colors border ${
                scenario === "burst-spike" && algoA === "token-bucket" && algoB === "leaky-bucket"
                  ? "border-[#FF5400] text-[#FF5400] bg-[#FF5400]/10"
                  : "border-white/10 text-white/60 hover:text-white hover:border-white/20 bg-white/5"
              }`}
            >
              Burst: Token vs Leaky
            </button>
            <button
              onClick={() => triggerPreset("heavy-client", "fixed-window", "token-bucket")}
              aria-label="Preset: Monopolizing client traffic"
              className={`px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-mono transition-colors border ${
                scenario === "heavy-client" && algoA === "fixed-window" && algoB === "token-bucket"
                  ? "border-[#FF5400] text-[#FF5400] bg-[#FF5400]/10"
                  : "border-white/10 text-white/60 hover:text-white hover:border-white/20 bg-white/5"
              }`}
            >
              Monopolizing Client
            </button>
          </div>
        </div>

        {/* Configuration Row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 pt-4 items-end">
          {/* Algorithm A Selection */}
          <div className="md:col-span-3 flex flex-col gap-1.5">
            <label className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">
              Algorithm Alpha (Primary)
            </label>
            <select
              value={algoA}
              onChange={(e) => setAlgoA(e.target.value as AlgorithmType)}
              aria-label="Algorithm Alpha (Primary)"
              className="w-full bg-[#060608] border border-white/10 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#FF5400]"
            >
              {ALGORITHMS.map((algo) => (
                <option key={algo.id} value={algo.id}>
                  {algo.label} ({algo.complexity})
                </option>
              ))}
            </select>
          </div>

          {/* Versus Divider */}
          <div className="md:col-span-1 flex items-center justify-center py-1 md:pb-2">
            <span className="font-mono text-xs font-bold text-[#FF5400] tracking-widest">VS</span>
          </div>

          {/* Algorithm B Selection */}
          <div className="md:col-span-3 flex flex-col gap-1.5">
            <label className="text-[10px] font-mono uppercase tracking-widest text-cyan-400">
              Algorithm Beta (Comparison)
            </label>
            <select
              value={algoB}
              onChange={(e) => setAlgoB(e.target.value as AlgorithmType)}
              aria-label="Algorithm Beta (Comparison)"
              className="w-full bg-[#060608] border border-white/10 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#FF5400]"
            >
              {ALGORITHMS.map((algo) => (
                <option key={algo.id} value={algo.id}>
                  {algo.label} ({algo.complexity})
                </option>
              ))}
            </select>
          </div>

          {/* Scenario Selection */}
          <div className="md:col-span-3 flex flex-col gap-1.5">
            <label className="text-[10px] font-mono uppercase tracking-widest text-white/50">
              Attack / Traffic Pattern
            </label>
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as ScenarioType)}
              aria-label="Attack or traffic pattern scenario"
              className="w-full bg-[#060608] border border-white/10 px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#FF5400]"
            >
              {SCENARIOS.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.label}
                </option>
              ))}
            </select>
          </div>

          {/* Run Action */}
          <div className="md:col-span-2">
            <button
              onClick={() => runComparison()}
              disabled={isLoading}
              aria-label="Run comparison replay"
              className="w-full bg-[#FF5400] hover:bg-[#e04a00] text-black font-mono font-medium text-xs px-4 py-2.5 transition-colors flex items-center justify-center gap-2 uppercase tracking-wider disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                  <span>Replaying...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-black" />
                  <span>Run Replay</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Selected Scenario Description */}
        <div className="mt-3 pt-3 border-t border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] font-mono text-white/40">
          <div className="min-w-0">
            <span className="text-white/60">Scenario Detail: </span>
            <span>{SCENARIOS.find((s) => s.id === scenario)?.description}</span>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 text-[10px] shrink-0">
            <span>LIMIT: {limit} REQ</span>
            <span>WINDOW: {windowSizeMs / 1000}s</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-red-500/30 bg-red-500/10 p-4 text-xs font-mono text-red-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Error: {error}</span>
        </div>
      )}

      {/* Divergence Radar & Invariant Proof Banner */}
      {comparisonData && (
        <div
          className={`relative border p-3.5 sm:p-5 transition-all max-w-full ${
            comparisonData.boundaryLeakDetected
              ? "border-[#FF5400] bg-[#FF5400]/10"
              : comparisonData.divergence !== 0
              ? "border-amber-500/50 bg-amber-500/10"
              : "border-emerald-500/30 bg-emerald-500/5"
          }`}
        >
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
            <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
              {comparisonData.boundaryLeakDetected ? (
                <AlertTriangle className="w-6 h-6 text-[#FF5400] shrink-0 mt-0.5" />
              ) : comparisonData.divergence !== 0 ? (
                <ArrowRightLeft className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs uppercase tracking-widest font-bold text-white break-words">
                    {comparisonData.boundaryLeakDetected
                      ? "Boundary Burst Exploit Invariant: Leaked Traffic Detected"
                      : comparisonData.divergence !== 0
                      ? `Algorithmic Divergence: ${Math.abs(comparisonData.divergence)} Request Delta`
                      : "Strict Mathematical Parity: Identical Enforcement"}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 uppercase bg-black/40 border border-white/10 text-white/80 shrink-0">
                    Δ = {comparisonData.divergence > 0 ? `+${comparisonData.divergence}` : comparisonData.divergence} REQS
                  </span>
                </div>
                <p className="text-xs font-mono text-white/70 mt-1 max-w-4xl break-words">
                  {comparisonData.boundaryLeakDetected ? (
                    <>
                      <strong className="text-[#FF5400]">Boundary Leak Proved:</strong> Fixed Window admitted{" "}
                      <span className="text-[#FF5400] font-bold">{comparisonData.algoA.allowed} requests</span> across the 60s
                      window boundary (100% exploit over-admission). Sliding Window Counter strictly throttled to{" "}
                      <span className="text-emerald-400 font-bold">{comparisonData.algoB.allowed} requests</span> via weighted
                      previous-window estimation.
                    </>
                  ) : comparisonData.divergence !== 0 ? (
                    <>
                      Under {comparisonData.scenario} traffic, {getAlgoMeta(comparisonData.algoA.algorithm).label} admitted{" "}
                      <span className="text-white font-bold">{comparisonData.algoA.allowed}</span> requests while{" "}
                      {getAlgoMeta(comparisonData.algoB.algorithm).label} admitted{" "}
                      <span className="text-white font-bold">{comparisonData.algoB.allowed}</span> requests.
                    </>
                  ) : (
                    <>Both algorithms made identical admission decisions for all {comparisonData.totalRequests} requests.</>
                  )}
                </p>
              </div>
            </div>

            {/* Quick Metrics Badge */}
            <div className="flex items-center justify-around sm:justify-end gap-4 sm:gap-6 w-full lg:w-auto shrink-0 bg-black/40 px-3 sm:px-4 py-2 border border-white/5">
              <div className="text-right">
                <div className="text-[9px] font-mono text-white/40 uppercase">Replay Requests</div>
                <div className="text-base font-mono font-bold text-white">{comparisonData.totalRequests}</div>
              </div>
              <div className="w-[1px] h-7 bg-white/10" />
              <div className="text-right">
                <div className="text-[9px] font-mono text-white/40 uppercase">Divergence %</div>
                <div
                  className={`text-base font-mono font-bold ${
                    comparisonData.divergence !== 0 ? "text-[#FF5400]" : "text-emerald-400"
                  }`}
                >
                  {((Math.abs(comparisonData.divergence) / comparisonData.totalRequests) * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Side-by-Side Dual Engine Comparison Cards */}
      {comparisonData && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 max-w-full">
          {/* Algorithm A Card */}
          <div className="relative border border-emerald-500/30 bg-[#0c0c10] p-3.5 sm:p-5 max-w-full">
            <div className="absolute -top-1 -left-1 text-emerald-400 text-[10px] font-mono leading-none select-none">+</div>
            <div className="absolute -top-1 -right-1 text-emerald-400 text-[10px] font-mono leading-none select-none">+</div>
            <div className="absolute -bottom-1 -left-1 text-emerald-400 text-[10px] font-mono leading-none select-none">+</div>
            <div className="absolute -bottom-1 -right-1 text-emerald-400 text-[10px] font-mono leading-none select-none">+</div>

            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  ALPHA
                </span>
                <span className="text-sm font-mono font-bold text-white">
                  {getAlgoMeta(comparisonData.algoA.algorithm).label}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-white/40">
                <span>TIME: {getAlgoMeta(comparisonData.algoA.algorithm).complexity}</span>
                <span>•</span>
                <span>SPACE: {getAlgoMeta(comparisonData.algoA.algorithm).space}</span>
              </div>
            </div>

            {/* Verdict Meters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 my-4 sm:my-5">
              <div className="bg-[#060608] border border-white/5 p-3">
                <div className="text-[10px] font-mono uppercase text-emerald-400 mb-1">Allowed Requests</div>
                <div className="text-xl sm:text-2xl font-mono font-bold text-emerald-400 break-words">
                  {comparisonData.algoA.allowed}
                  <span className="text-xs text-white/40 block sm:inline sm:ml-1.5 font-normal">
                    / {comparisonData.algoA.total} (
                    {((comparisonData.algoA.allowed / comparisonData.algoA.total) * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="w-full bg-white/10 h-1.5 mt-2 rounded-none overflow-hidden">
                  <div
                    className="bg-emerald-400 h-full transition-all duration-500"
                    style={{ width: `${(comparisonData.algoA.allowed / comparisonData.algoA.total) * 100}%` }}
                  />
                </div>
              </div>

              <div className="bg-[#060608] border border-white/5 p-3">
                <div className="text-[10px] font-mono uppercase text-red-400 mb-1">Rejected (429)</div>
                <div className="text-xl sm:text-2xl font-mono font-bold text-red-400 break-words">
                  {comparisonData.algoA.rejected}
                  <span className="text-xs text-white/40 block sm:inline sm:ml-1.5 font-normal">
                    / {comparisonData.algoA.total} (
                    {((comparisonData.algoA.rejected / comparisonData.algoA.total) * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="w-full bg-white/10 h-1.5 mt-2 rounded-none overflow-hidden">
                  <div
                    className="bg-red-400 h-full transition-all duration-500"
                    style={{ width: `${(comparisonData.algoA.rejected / comparisonData.algoA.total) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Latency & State Snapshot */}
            <div className="flex items-center justify-between text-xs font-mono py-2 px-3 bg-[#060608] border border-white/5">
              <span className="text-white/40">Avg Decision Latency:</span>
              <span className="text-white font-bold">{comparisonData.algoA.avgLatencyNs.toLocaleString()} ns</span>
            </div>

            {/* State Inspector Snapshot */}
            <div className="mt-3 text-[11px] font-mono bg-black/60 border border-white/5 p-3">
              <div className="text-[9px] uppercase tracking-wider text-white/40 mb-1.5 flex items-center justify-between">
                <span>Final Internal State</span>
                <span className="text-emerald-400/80">O(1) Memory Record</span>
              </div>
              <pre className="text-white/70 overflow-x-auto text-[10px] leading-relaxed max-w-full">
                {JSON.stringify(comparisonData.algoA.internalState, null, 2)}
              </pre>
            </div>
          </div>

          {/* Algorithm B Card */}
          <div className="relative border border-cyan-500/30 bg-[#0c0c10] p-3.5 sm:p-5 max-w-full">
            <div className="absolute -top-1 -left-1 text-cyan-400 text-[10px] font-mono leading-none select-none">+</div>
            <div className="absolute -top-1 -right-1 text-cyan-400 text-[10px] font-mono leading-none select-none">+</div>
            <div className="absolute -bottom-1 -left-1 text-cyan-400 text-[10px] font-mono leading-none select-none">+</div>
            <div className="absolute -bottom-1 -right-1 text-cyan-400 text-[10px] font-mono leading-none select-none">+</div>

            <div className="flex items-center justify-between pb-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  BETA
                </span>
                <span className="text-sm font-mono font-bold text-white">
                  {getAlgoMeta(comparisonData.algoB.algorithm).label}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-white/40">
                <span>TIME: {getAlgoMeta(comparisonData.algoB.algorithm).complexity}</span>
                <span>•</span>
                <span>SPACE: {getAlgoMeta(comparisonData.algoB.algorithm).space}</span>
              </div>
            </div>

            {/* Verdict Meters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 my-4 sm:my-5">
              <div className="bg-[#060608] border border-white/5 p-3">
                <div className="text-[10px] font-mono uppercase text-cyan-400 mb-1">Allowed Requests</div>
                <div className="text-xl sm:text-2xl font-mono font-bold text-cyan-400 break-words">
                  {comparisonData.algoB.allowed}
                  <span className="text-xs text-white/40 block sm:inline sm:ml-1.5 font-normal">
                    / {comparisonData.algoB.total} (
                    {((comparisonData.algoB.allowed / comparisonData.algoB.total) * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="w-full bg-white/10 h-1.5 mt-2 rounded-none overflow-hidden">
                  <div
                    className="bg-cyan-400 h-full transition-all duration-500"
                    style={{ width: `${(comparisonData.algoB.allowed / comparisonData.algoB.total) * 100}%` }}
                  />
                </div>
              </div>

              <div className="bg-[#060608] border border-white/5 p-3">
                <div className="text-[10px] font-mono uppercase text-red-400 mb-1">Rejected (429)</div>
                <div className="text-xl sm:text-2xl font-mono font-bold text-red-400 break-words">
                  {comparisonData.algoB.rejected}
                  <span className="text-xs text-white/40 block sm:inline sm:ml-1.5 font-normal">
                    / {comparisonData.algoB.total} (
                    {((comparisonData.algoB.rejected / comparisonData.algoB.total) * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="w-full bg-white/10 h-1.5 mt-2 rounded-none overflow-hidden">
                  <div
                    className="bg-red-400 h-full transition-all duration-500"
                    style={{ width: `${(comparisonData.algoB.rejected / comparisonData.algoB.total) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Latency & State Snapshot */}
            <div className="flex items-center justify-between text-xs font-mono py-2 px-3 bg-[#060608] border border-white/5">
              <span className="text-white/40">Avg Decision Latency:</span>
              <span className="text-white font-bold">{comparisonData.algoB.avgLatencyNs.toLocaleString()} ns</span>
            </div>

            {/* State Inspector Snapshot */}
            <div className="mt-3 text-[11px] font-mono bg-black/60 border border-white/5 p-3">
              <div className="text-[9px] uppercase tracking-wider text-white/40 mb-1.5 flex items-center justify-between">
                <span>Final Internal State</span>
                <span className="text-cyan-400/80">O(1) Memory Record</span>
              </div>
              <pre className="text-white/70 overflow-x-auto text-[10px] leading-relaxed max-w-full">
                {JSON.stringify(comparisonData.algoB.internalState, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Comparative View Switcher & Detailed Visualizer */}
      {comparisonData && (
        <div className="relative border border-white/10 bg-[#0c0c10] p-3.5 sm:p-5 max-w-full">
          <div className="absolute -top-1 -left-1 text-white/30 text-[10px] font-mono leading-none select-none">+</div>
          <div className="absolute -top-1 -right-1 text-white/30 text-[10px] font-mono leading-none select-none">+</div>
          <div className="absolute -bottom-1 -left-1 text-white/30 text-[10px] font-mono leading-none select-none">+</div>
          <div className="absolute -bottom-1 -right-1 text-white/30 text-[10px] font-mono leading-none select-none">+</div>

          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 pb-4 border-b border-white/5">
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => setActiveTab("timeline")}
                className={`px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-mono transition-colors border ${
                  activeTab === "timeline"
                    ? "border-[#FF5400] text-[#FF5400] bg-[#FF5400]/10"
                    : "border-white/10 text-white/50 hover:text-white"
                }`}
              >
                Side-by-Side Timeline (20 Slices)
              </button>
              <button
                onClick={() => setActiveTab("samples")}
                className={`px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-mono transition-colors border ${
                  activeTab === "samples"
                    ? "border-[#FF5400] text-[#FF5400] bg-[#FF5400]/10"
                    : "border-white/10 text-white/50 hover:text-white"
                }`}
              >
                Sample Divergence Telemetry Log
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-[10px] font-mono text-white/40">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-emerald-400 inline-block shrink-0" /> Alpha Allowed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-cyan-400 inline-block shrink-0" /> Beta Allowed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-red-400 inline-block shrink-0" /> Blocked (429)
              </span>
            </div>
          </div>

          {activeTab === "timeline" ? (
            <div className="pt-4 sm:pt-5">
              {/* Timeline Histogram Slices */}
              <div className="overflow-x-auto max-w-full">
                <div
                  className="grid gap-1 h-36 items-end bg-[#060608] border border-white/5 p-3 min-w-[340px]"
                  style={{ gridTemplateColumns: "repeat(20, minmax(0, 1fr))" }}
                >
                  {comparisonData.timeline.map((bucket) => {
                    const maxCount = Math.max(
                      ...comparisonData.timeline.map((b) =>
                        Math.max(b.allowedA + b.rejectedA, b.allowedB + b.rejectedB)
                      ),
                      1
                    );
                    const heightA = ((bucket.allowedA + bucket.rejectedA) / maxCount) * 100;
                    const heightB = ((bucket.allowedB + bucket.rejectedB) / maxCount) * 100;
                    const hasDivergence = bucket.allowedA !== bucket.allowedB;

                    return (
                      <div
                        key={bucket.bucketIndex}
                        className="group relative flex flex-col justify-end h-full gap-0.5 items-center hover:bg-white/5 px-0.5 transition-colors"
                      >
                        {/* Bar A (Left) */}
                        <div className="w-full flex flex-col-reverse" style={{ height: `${heightA}%` }}>
                          <div
                            className="bg-emerald-400 w-full"
                            style={{
                              height: `${
                                (bucket.allowedA / Math.max(bucket.allowedA + bucket.rejectedA, 1)) * 100
                              }%`,
                            }}
                          />
                          <div
                            className="bg-red-400/60 w-full"
                            style={{
                              height: `${
                                (bucket.rejectedA / Math.max(bucket.allowedA + bucket.rejectedA, 1)) * 100
                              }%`,
                            }}
                          />
                        </div>

                        {/* Bar B (Right) */}
                        <div className="w-full flex flex-col-reverse" style={{ height: `${heightB}%` }}>
                          <div
                            className="bg-cyan-400 w-full"
                            style={{
                              height: `${
                                (bucket.allowedB / Math.max(bucket.allowedB + bucket.rejectedB, 1)) * 100
                              }%`,
                            }}
                          />
                          <div
                            className="bg-red-400/60 w-full"
                            style={{
                              height: `${
                                (bucket.rejectedB / Math.max(bucket.allowedB + bucket.rejectedB, 1)) * 100
                              }%`,
                            }}
                          />
                        </div>

                        {/* Divergence Marker */}
                        {hasDivergence && (
                          <div className="w-1.5 h-1.5 rounded-full bg-[#FF5400] mb-0.5 shrink-0" />
                        )}

                        {/* Hover Tooltip */}
                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 pointer-events-none hidden group-hover:flex flex-col bg-[#111116] border border-white/20 p-2 z-30 min-w-[150px] shadow-2xl">
                          <div className="text-[9px] font-mono text-white/50 border-b border-white/10 pb-1 mb-1">
                            Slice #{bucket.bucketIndex + 1} ({bucket.timeMs.toFixed(0)}ms)
                          </div>
                          <div className="text-[10px] font-mono text-emerald-400 flex justify-between">
                            <span>Alpha Allowed:</span>
                            <span>{bucket.allowedA}</span>
                          </div>
                          <div className="text-[10px] font-mono text-cyan-400 flex justify-between">
                            <span>Beta Allowed:</span>
                            <span>{bucket.allowedB}</span>
                          </div>
                          <div className="text-[10px] font-mono text-red-400 flex justify-between">
                            <span>Alpha Blocked:</span>
                            <span>{bucket.rejectedA}</span>
                          </div>
                          <div className="text-[10px] font-mono text-red-400 flex justify-between">
                            <span>Beta Blocked:</span>
                            <span>{bucket.rejectedB}</span>
                          </div>
                          {hasDivergence && (
                            <div className="text-[10px] font-mono text-[#FF5400] border-t border-white/10 pt-1 mt-1 font-bold">
                              Δ = {Math.abs(bucket.allowedA - bucket.allowedB)} Leaked
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[9px] sm:text-[10px] font-mono text-white/40 mt-2 px-1 gap-1">
                <span>T = 0ms (Start of Test)</span>
                <span>T = {((comparisonData.windowSizeMs) / 1000).toFixed(0)}s (Boundary Transition)</span>
                <span>T = {((comparisonData.windowSizeMs * 1.05) / 1000).toFixed(0)}s (Replay End)</span>
              </div>
            </div>
          ) : (
            /* Sample Requests Telemetry Table */
            <div className="pt-4 overflow-x-auto max-w-full">
              <table className="w-full text-left font-mono text-xs min-w-[480px]">
                <thead>
                  <tr className="border-b border-white/10 text-white/40 text-[10px] uppercase">
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Timestamp</th>
                    <th className="py-2 px-3">Client ID</th>
                    <th className="py-2 px-3">Alpha ({getAlgoMeta(comparisonData.algoA.algorithm).label})</th>
                    <th className="py-2 px-3">Beta ({getAlgoMeta(comparisonData.algoB.algorithm).label})</th>
                    <th className="py-2 px-3">Parity Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {comparisonData.sampleRequests.map((sample) => {
                    const isDiverged = sample.allowedA !== sample.allowedB;
                    return (
                      <tr
                        key={sample.index}
                        className={`hover:bg-white/5 ${
                          isDiverged ? "bg-[#FF5400]/5" : ""
                        }`}
                      >
                        <td className="py-2 px-3 text-white/40 text-[11px]">{sample.index}</td>
                        <td className="py-2 px-3 text-white/70">{sample.timestampMs.toLocaleString()}ms</td>
                        <td className="py-2 px-3 text-white/90">{sample.clientId}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`inline-block px-1.5 py-0.5 text-[10px] font-mono ${
                              sample.allowedA
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                : "bg-red-500/20 text-red-400 border border-red-500/30"
                            }`}
                          >
                            {sample.allowedA ? "200 OK" : "429 REJECT"}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`inline-block px-1.5 py-0.5 text-[10px] font-mono ${
                              sample.allowedB
                                ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                                : "bg-red-500/20 text-red-400 border border-red-500/30"
                            }`}
                          >
                            {sample.allowedB ? "200 OK" : "429 REJECT"}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          {isDiverged ? (
                            <span className="text-[10px] text-[#FF5400] font-bold flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              DIVERGED
                            </span>
                          ) : (
                            <span className="text-[10px] text-white/30">MATCH</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
