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
import { Activity, Gauge, GitCompare, BarChart3, AlertCircle } from "lucide-react";

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
          // Auto reconnect after 2 seconds
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
    <div className="min-h-screen bg-cockpit-950 pb-16">
      <Header
        clusterMode={mode}
        currentAlgorithm={algorithm}
        isStreaming={isStreaming}
        onRefreshCluster={handleReset}
      />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-8">
        {/* Cockpit Control Bar */}
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

        {/* Modular Telemetry Workspace (Prepared for Commits 7.2, 7.3, 7.4) */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Timeline Placeholder */}
          <div className="cockpit-panel rounded-2xl p-6 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                <Activity className="h-4 w-4 text-cyan-400" />
                60 FPS LIVE TELEMETRY TIMELINE
              </div>
              <span className="rounded bg-slate-800/80 px-2 py-0.5 font-mono text-[11px] text-slate-400">
                100ms Ticks
              </span>
            </div>
            <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-slate-800/80 bg-slate-950/40 text-center">
              <div>
                <BarChart3 className="mx-auto h-8 w-8 text-slate-600 animate-pulse" />
                <p className="mt-2 text-xs font-medium text-slate-400">
                  Telemetry canvas stream ready (Commit 7.2)
                </p>
                <p className="text-[11px] text-slate-600">
                  Dual stacked lines: Allowed (emerald) vs Rejected (rose)
                </p>
              </div>
            </div>
          </div>

          {/* Instance Gauges Placeholder */}
          <div className="cockpit-panel rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                <Gauge className="h-4 w-4 text-cyan-400" />
                INSTANCE DISTRIBUTION
              </div>
              <span className="rounded bg-slate-800/80 px-2 py-0.5 font-mono text-[11px] text-slate-400">
                Round-Robin
              </span>
            </div>
            <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-slate-800/80 bg-slate-950/40 text-center">
              <div>
                <Gauge className="mx-auto h-8 w-8 text-slate-600" />
                <p className="mt-2 text-xs font-medium text-slate-400">
                  Load gauges & state inspector (Commit 7.3)
                </p>
                <p className="text-[11px] text-slate-600">
                  Node 1 (:4001), Node 2 (:4002), Node 3 (:4003)
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
