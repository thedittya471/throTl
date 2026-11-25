"useStrictMode";
"use client";

import React, { useState, useEffect, useRef } from "react";
import { Header } from "../components/Header";
import {
  ControlPanel,
  type AlgorithmType,
  type LimiterMode,
  type ScenarioPreset,
  type TrafficPattern,
} from "../components/ControlPanel";
import { TimelineVisualizer } from "../components/TimelineVisualizer";
import { InstanceGauges } from "../components/InstanceGauges";
import { AlgorithmStateCard } from "../components/AlgorithmStateCard";
import { ComparisonMatrix } from "../components/ComparisonMatrix";
import { GuidedTour } from "../components/GuidedTour";
import { shouldIgnoreGlobalKey, shouldIgnoreGlobalSpace } from "../lib/keyboard";

export default function Dashboard() {
  const [viewMode, setViewMode] = useState<"cockpit" | "comparison">("cockpit");
  const [algorithm, setAlgorithm] = useState<AlgorithmType>("fixed-window");
  const [mode, setMode] = useState<LimiterMode>("per-instance");
  const [scenario, setScenario] = useState<ScenarioPreset>("custom");
  const [pattern, setPattern] = useState<TrafficPattern>("steady");
  const [targetRps, setTargetRps] = useState<number>(500);
  const [clientCount, setClientCount] = useState<number>(100);
  const [limit, setLimit] = useState<number>(100);
  const [windowSizeMs, setWindowSizeMs] = useState<number>(60000);

  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isTourOpen, setIsTourOpen] = useState<boolean>(false);
  const [latestTick, setLatestTick] = useState<any>(null);
  const [stats, setStats] = useState<{
    totalEmitted: number;
    currentRps: number;
    elapsedMs: number;
  } | null>(null);

  const sseRef = useRef<EventSource | null>(null);

  // Auto-launch guided tour on first visit
  useEffect(() => {
    if (typeof window !== "undefined") {
      const completed = localStorage.getItem("ratelab_tour_completed");
      if (!completed) {
        setIsTourOpen(true);
      }
    }
  }, []);

  // Connect to SSE metrics stream
  useEffect(() => {
    function connectSSE() {
      try {
        const es = new EventSource("/api/stream/metrics");
        sseRef.current = es;

        es.onopen = () => {
          setIsStreaming(true);
        };

        es.onmessage = (event) => {
          try {
            const tick = JSON.parse(event.data);
            if (tick && tick.totalCount !== undefined) {
              setLatestTick(tick);
              setStats((prev) => ({
                totalEmitted: (prev?.totalEmitted || 0) + tick.totalCount,
                currentRps: tick.totalCount * 10,
                elapsedMs: (prev?.elapsedMs || 0) + tick.windowDurationMs,
              }));
            }
          } catch {
            // Heartbeat comment or non-json
          }
        };

        es.onerror = () => {
          setIsStreaming(false);
          es.close();
          setTimeout(connectSSE, 2000);
        };
      } catch {
        setIsStreaming(false);
      }
    }

    connectSSE();

    return () => {
      if (sseRef.current) {
        sseRef.current.close();
      }
    };
  }, []);

  const initialLoadedRef = useRef<boolean>(false);

  // Poll simulator status periodically and sync active configuration
  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/simulator/status");
        if (res.ok) {
          const data = await res.json();
          setIsRunning(data.running);
          setIsPaused(data.paused);
          if (data.stats) {
            setStats(data.stats);
          }
          if (!initialLoadedRef.current) {
            initialLoadedRef.current = true;
            if (data.algorithm) setAlgorithm(data.algorithm);
            if (data.mode) setMode(data.mode);
            if (data.limit) setLimit(data.limit);
            if (data.windowSizeMs) setWindowSizeMs(data.windowSizeMs);
          }
        }
      } catch {
        // Fallback
      }
    }

    checkStatus();
    const interval = setInterval(checkStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleAlgorithmChange = async (algo: AlgorithmType) => {
    setAlgorithm(algo);
    try {
      await fetch("/api/simulator/configure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ algorithm: algo, limit, windowSizeMs }),
      });
    } catch (err) {
      console.error("Failed to update algorithm", err);
    }
  };

  const handleModeChange = async (newMode: LimiterMode) => {
    setMode(newMode);
    try {
      await fetch("/api/simulator/configure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
    } catch (err) {
      console.error("Failed to update mode", err);
    }
  };

  const handleScenarioChange = (newScenario: ScenarioPreset) => {
    setScenario(newScenario);
    if (newScenario === "login-brute-force") {
      setTargetRps(50);
      setClientCount(1);
      setPattern("steady");
    } else if (newScenario === "search-spike") {
      setTargetRps(500);
      setClientCount(500);
      setPattern("burst");
    } else if (newScenario === "payment-retries") {
      setTargetRps(200);
      setClientCount(200);
      setPattern("burst");
    } else if (newScenario === "file-uploads") {
      setTargetRps(50);
      setClientCount(20);
      setPattern("steady");
    }
  };

  const handleStart = async () => {
    try {
      const payload: any = {
        targetRps,
        clientCount,
        pattern,
      };
      if (scenario !== "custom") {
        payload.scenario = scenario;
      }
      const res = await fetch("/api/simulator/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setIsRunning(true);
        setIsPaused(false);
      }
    } catch (err) {
      console.error("Failed to start simulator", err);
    }
  };

  const handlePause = async () => {
    try {
      const res = await fetch("/api/simulator/pause", { method: "POST" });
      if (res.ok) setIsPaused(true);
    } catch (err) {
      console.error("Failed to pause", err);
    }
  };

  const handleResume = async () => {
    try {
      const res = await fetch("/api/simulator/resume", { method: "POST" });
      if (res.ok) setIsPaused(false);
    } catch (err) {
      console.error("Failed to resume", err);
    }
  };

  const handleStop = async () => {
    try {
      const res = await fetch("/api/simulator/stop", { method: "POST" });
      if (res.ok) {
        setIsRunning(false);
        setIsPaused(false);
      }
    } catch (err) {
      console.error("Failed to stop", err);
    }
  };

  const handleReset = async () => {
    try {
      await fetch("/api/simulator/reset", { method: "POST" });
      setStats({ totalEmitted: 0, currentRps: 0, elapsedMs: 0 });
      setIsRunning(false);
      setIsPaused(false);
      setLatestTick(null);
    } catch (err) {
      console.error("Failed to reset cluster", err);
    }
  };

  // Keyboard Shortcuts for enhanced user flow
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (shouldIgnoreGlobalKey(target)) {
        return;
      }

      if (e.code === "Space") {
        if (shouldIgnoreGlobalSpace(target)) {
          return;
        }
        e.preventDefault();
        if (!isRunning) {
          handleStart();
        } else if (isPaused) {
          handleResume();
        } else {
          handlePause();
        }
      } else if (e.key === "Escape" || e.key === "h" || e.key === "H") {
        if (isRunning) {
          handleStop();
        }
      } else if (e.key === "r" || e.key === "R") {
        handleReset();
      } else if (e.key === "?") {
        setIsTourOpen((prev) => !prev);
      } else if (e.key === "1") {
        setViewMode("cockpit");
      } else if (e.key === "2") {
        setViewMode("comparison");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRunning, isPaused, targetRps, clientCount, pattern, scenario]);

  return (
    <div className="min-h-screen bg-carbon-950 text-carbon-100 studio-grid pb-20">
      <GuidedTour
        run={isTourOpen}
        onFinish={() => setIsTourOpen(false)}
      />

      <Header
        clusterMode={mode}
        currentAlgorithm={algorithm}
        isStreaming={isStreaming}
        onRefreshCluster={handleReset}
        onStartTour={() => setIsTourOpen(true)}
        isTourRunning={isTourOpen}
      />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-8">
        {/* Editorial Studio Hero Header */}
        <section className="border-b border-white/[0.08] pb-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 font-mono text-[10px] text-studio-orange uppercase tracking-widest mb-1.5">
                <span>[ HARNESS VER 1.0 ]</span>
                <span className="text-carbon-600">//</span>
                <span>SUB-MILLI HIGH RESOLUTION</span>
              </div>
              <h1 className="font-mono text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white">
                Distributed Rate Limiting Simulator
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-4 font-mono text-[11px] text-carbon-400">
              <div className="border border-white/[0.08] bg-carbon-900/60 px-3 py-1.5">
                <span className="text-carbon-500">ENGINE:</span>{" "}
                <span className="font-bold text-white uppercase">{algorithm}</span>
              </div>
              <div className="border border-white/[0.08] bg-carbon-900/60 px-3 py-1.5">
                <span className="text-carbon-500">LIMIT:</span>{" "}
                <span className="font-bold text-studio-orange">{limit} REQ / {windowSizeMs / 1000}S</span>
              </div>
            </div>
          </div>
        </section>

        {/* View Mode Switcher */}
        <div data-tour="view-mode" className="flex flex-wrap items-center gap-2 sm:gap-3 border-b border-white/[0.08] pb-4">
          <button
            onClick={() => setViewMode("cockpit")}
            className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all border ${
              viewMode === "cockpit"
                ? "border-studio-orange text-studio-orange bg-studio-orange/10 font-bold"
                : "border-white/10 text-white/50 hover:text-white hover:border-white/20 bg-carbon-900/40"
            }`}
          >
            [ 01 ] Cockpit Monitor
          </button>
          <button
            onClick={() => setViewMode("comparison")}
            className={`px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all border ${
              viewMode === "comparison"
                ? "border-studio-orange text-studio-orange bg-studio-orange/10 font-bold"
                : "border-white/10 text-white/50 hover:text-white hover:border-white/20 bg-carbon-900/40"
            }`}
          >
            [ 02 ] Comparison Matrix
          </button>
        </div>

        {viewMode === "cockpit" ? (
          <>
            {/* 3-Step User Flow Pipeline Tracker */}
            <section data-tour="workflow-pipeline">
              <div className="border border-white/[0.08] bg-carbon-900/60 p-3 sm:p-4 font-mono text-[11px]">
                <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                  {/* Phase 1 */}
                  <div
                    className={`flex-1 flex items-center gap-3 p-2.5 border transition ${
                      !isRunning
                        ? "border-studio-orange/60 bg-studio-orange/5 text-white"
                        : "border-white/[0.06] bg-carbon-950/60 text-carbon-400"
                    }`}
                  >
                    <div
                      className={`h-6 w-6 flex items-center justify-center rounded-sm font-bold text-[10px] ${
                        !isRunning ? "bg-studio-orange text-carbon-950 font-black" : "bg-carbon-800 text-carbon-400"
                      }`}
                    >
                      01
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] uppercase tracking-wider text-carbon-500">ENGINE & TOPOLOGY</div>
                      <div className="font-bold truncate text-white">
                        {algorithm.toUpperCase()} • {mode === "shared" ? "SHARED_REDIS" : "PER_INSTANCE"}
                      </div>
                    </div>
                  </div>

                  <div className="hidden md:block text-carbon-600 font-bold">→</div>

                  {/* Phase 2 */}
                  <div
                    className={`flex-1 flex items-center gap-3 p-2.5 border transition ${
                      scenario !== "custom" || targetRps !== 500
                        ? "border-studio-orange/60 bg-studio-orange/5 text-white"
                        : "border-white/[0.06] bg-carbon-950/60 text-carbon-400"
                    }`}
                  >
                    <div
                      className={`h-6 w-6 flex items-center justify-center rounded-sm font-bold text-[10px] ${
                        scenario !== "custom" || targetRps !== 500
                          ? "bg-studio-orange text-carbon-950 font-black"
                          : "bg-carbon-800 text-carbon-400"
                      }`}
                    >
                      02
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] uppercase tracking-wider text-carbon-500">TRAFFIC SYNTHESIS</div>
                      <div className="font-bold truncate text-white">
                        {scenario === "custom" ? `${targetRps} RPS • ${pattern.toUpperCase()}` : scenario.toUpperCase()}
                      </div>
                    </div>
                  </div>

                  <div className="hidden md:block text-carbon-600 font-bold">→</div>

                  {/* Phase 3 */}
                  <div
                    className={`flex-1 flex items-center gap-3 p-2.5 border transition ${
                      isRunning
                        ? "border-studio-orange/80 bg-studio-orange/10 text-white shadow-sm shadow-studio-orange/20"
                        : "border-white/[0.06] bg-carbon-950/60 text-carbon-400"
                    }`}
                  >
                    <div
                      className={`h-6 w-6 flex items-center justify-center rounded-sm font-bold text-[10px] ${
                        isRunning ? "bg-studio-orange text-carbon-950 font-black" : "bg-carbon-800 text-carbon-400"
                      }`}
                    >
                      03
                    </div>
                    <div className="min-w-0">
                      <div className="text-[9px] uppercase tracking-wider text-carbon-500">BENCHMARK TELEMETRY</div>
                      <div className="font-bold truncate flex items-center gap-1.5 text-white">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isRunning
                              ? isPaused
                                ? "bg-amber-400"
                                : "bg-studio-orange animate-pulse"
                              : "bg-carbon-600"
                          }`}
                        />
                        <span>{isRunning ? (isPaused ? "PAUSED" : "ACTIVE 60 FPS") : "READY TO RUN"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Studio Control Panel */}
            <section>
              <ControlPanel
                algorithm={algorithm}
                onAlgorithmChange={handleAlgorithmChange}
                mode={mode}
                onModeChange={handleModeChange}
                scenario={scenario}
                onScenarioChange={handleScenarioChange}
                pattern={pattern}
                onPatternChange={setPattern}
                targetRps={targetRps}
                onTargetRpsChange={setTargetRps}
                clientCount={clientCount}
                onClientCountChange={setClientCount}
                limit={limit}
                onLimitChange={setLimit}
                windowSizeMs={windowSizeMs}
                onWindowSizeChange={setWindowSizeMs}
                isRunning={isRunning}
                isPaused={isPaused}
                onStart={handleStart}
                onPause={handlePause}
                onResume={handleResume}
                onStop={handleStop}
                onReset={handleReset}
                stats={stats}
              />
            </section>

            {/* 60 FPS Telemetry Canvas Timeline & Instance Gauges */}
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <TimelineVisualizer
                  latestTick={latestTick}
                  limit={limit}
                  isStreaming={isStreaming}
                />
              </div>

              <div>
                <InstanceGauges
                  distribution={latestTick?.instanceDistribution}
                  mode={mode}
                  limit={limit}
                />
              </div>
            </section>

            {/* Algorithm State Inspector */}
            <section>
              <AlgorithmStateCard
                algorithm={algorithm}
                stateSnapshot={latestTick?.internalStateSnapshot}
                limit={limit}
                windowSizeMs={windowSizeMs}
              />
            </section>
          </>
        ) : (
          <section>
            <ComparisonMatrix />
          </section>
        )}

        {/* Minimal Editorial Footer with Shortcut Cues */}
        <footer className="border-t border-white/[0.06] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-[10px] text-carbon-500">
          <div className="flex flex-wrap items-center gap-3">
            <span>KEYBOARD SHORTCUTS:</span>
            <span className="text-carbon-300">[SPACE] RUN/PAUSE</span>
            <span className="text-carbon-300">[ESC] HALT</span>
            <span className="text-carbon-300">[R] RESET</span>
            <span className="text-carbon-300">[?] GUIDED TOUR</span>
            <span className="text-carbon-300">[1/2] COCKPIT/MATRIX</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsTourOpen(true)}
              className="text-studio-orange hover:underline font-bold"
            >
              [ OPEN GUIDED TOUR ]
            </button>
            <span>THROTL // TWO26 STUDIO [26]</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
