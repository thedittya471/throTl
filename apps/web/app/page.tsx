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
import { Gauge } from "lucide-react";

export default function Dashboard() {
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
  const [latestTick, setLatestTick] = useState<any>(null);
  const [stats, setStats] = useState<{
    totalEmitted: number;
    currentRps: number;
    elapsedMs: number;
  } | null>(null);

  const sseRef = useRef<EventSource | null>(null);

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

  // Poll simulator status periodically
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
        }
      } catch {
        // Fallback
      }
    }

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
    } catch (err) {
      console.error("Failed to reset cluster", err);
    }
  };

  return (
    <div className="min-h-screen bg-carbon-950 text-carbon-100 studio-grid pb-20">
      <Header
        clusterMode={mode}
        currentAlgorithm={algorithm}
        isStreaming={isStreaming}
        onRefreshCluster={handleReset}
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

            <div className="flex items-center gap-4 font-mono text-[11px] text-carbon-400">
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

        {/* 60 FPS Telemetry Canvas Timeline (Commit 7.2) & Instance Gauges Slot */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Live Timeline Component */}
          <div className="lg:col-span-2">
            <TimelineVisualizer
              latestTick={latestTick}
              limit={limit}
              isStreaming={isStreaming}
            />
          </div>

          {/* Instance Gauges Slot (Commit 7.3) */}
          <div className="studio-card corner-crosshair p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="text-studio-orange font-bold">[ 06 ]</span>
                <span className="font-semibold uppercase tracking-wider text-white">
                  Cluster Distribution
                </span>
              </div>
              <span className="text-carbon-500">PREPARED FOR 7.3</span>
            </div>

            <div className="flex h-[240px] items-center justify-center border border-dashed border-white/[0.08] bg-carbon-950/60 text-center font-mono">
              <div className="space-y-1">
                <Gauge className="mx-auto h-6 w-6 text-carbon-400" />
                <div className="text-xs font-bold text-white uppercase tracking-wider pt-1">
                  Load Distribution Inspector
                </div>
                <div className="text-[10px] text-carbon-500">
                  Node 1 (:4001) // Node 2 (:4002) // Node 3 (:4003)
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Minimal Editorial Footer */}
        <footer className="border-t border-white/[0.06] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 font-mono text-[10px] text-carbon-500">
          <div>
            THROTL ARCHITECTURE // 5 ALGORITHMS // ATOMIC EVALSHA REDIS LUA // 1,000 REQ/S BENCHMARK
          </div>
          <div>
            INSPIRED BY TWO26 STUDIO [26]
          </div>
        </footer>
      </main>
    </div>
  );
}
