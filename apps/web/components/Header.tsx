"useStrictMode";
"use client";

import React, { useState, useEffect } from "react";
import { Shield, RefreshCw, Radio, Activity, Compass } from "lucide-react";

interface HeaderProps {
  clusterMode: "per-instance" | "shared";
  currentAlgorithm: string;
  isStreaming: boolean;
  onRefreshCluster?: () => void;
  onStartTour?: () => void;
  isTourRunning?: boolean;
}

export function Header({
  clusterMode,
  currentAlgorithm,
  isStreaming,
  onRefreshCluster,
  onStartTour,
  isTourRunning = false,
}: HeaderProps) {
  const [nodesAlive, setNodesAlive] = useState<number>(3);
  const [lastPingMs, setLastPingMs] = useState<number>(1);

  useEffect(() => {
    async function checkCluster() {
      const start = performance.now();
      try {
        const res = await fetch("/api/cluster/status");
        if (res.ok) {
          const data = await res.json();
          const alive = data.instances?.filter((i: any) => i.alive).length || 3;
          setNodesAlive(alive);
          setLastPingMs(Math.max(1, Math.round(performance.now() - start)));
        }
      } catch {
        // Fallback
      }
    }
    checkCluster();
    const interval = setInterval(checkCluster, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[0.07] bg-carbon-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-2.5 sm:px-6 sm:py-3">
        {/* Brand: throTl */}
        <div data-tour="brand" className="flex items-center gap-2 sm:gap-4 shrink-0">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-studio-orange font-mono text-xs font-black text-carbon-950 shadow-md shadow-studio-orange/20">
              T
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-base font-bold tracking-tighter text-white uppercase">
                thro<span className="text-studio-orange">Tl</span>
              </span>
              <span className="font-mono text-[10px] font-medium text-studio-orange tracking-widest">
                [26]
              </span>
            </div>
          </div>

          <div className="hidden h-4 w-px bg-white/10 md:block" />

          <div className="hidden items-center gap-2 font-mono text-[11px] text-carbon-400 md:flex">
            <span className="text-carbon-500">//</span>
            <span>HIGH-PRECISION BENCHMARK HARNESS</span>
          </div>
        </div>

        {/* Studio Status Bar */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Active Mode Pill */}
          <div className="hidden items-center gap-2 border border-white/[0.08] bg-carbon-900/90 px-3 py-1 font-mono text-[11px] sm:flex">
            <span className="text-carbon-500">MODE:</span>
            <span
              className={`font-semibold tracking-wider ${
                clusterMode === "shared" ? "text-studio-orange" : "text-amber-400"
              }`}
            >
              {clusterMode === "shared" ? "REDIS_LUA" : "PER_INSTANCE"}
            </span>
          </div>

          {/* Cluster Nodes Pill */}
          <div className="flex items-center gap-1.5 sm:gap-2 border border-white/[0.08] bg-carbon-900/90 px-2 py-1 sm:px-3 font-mono text-[10px] sm:text-[11px]">
            <span className="hidden min-[420px]:inline text-carbon-500">NODES:</span>
            <span className="font-medium text-white">
              {nodesAlive}/3
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] shrink-0" />
          </div>

          {/* SSE Live Stream Status */}
          <div className="hidden min-[480px]:flex items-center gap-1.5 sm:gap-2 border border-white/[0.08] bg-carbon-900/90 px-2 py-1 sm:px-3 font-mono text-[10px] sm:text-[11px]">
            <Radio className={`h-3 w-3 shrink-0 ${isStreaming ? "text-studio-orange animate-pulse" : "text-carbon-500"}`} />
            <span className="hidden sm:inline text-carbon-500">SSE:</span>
            <span className={isStreaming ? "font-semibold text-white" : "text-carbon-500"}>
              {isStreaming ? `${lastPingMs}ms` : "OFFLINE"}
            </span>
          </div>

          {/* Guided Tour Launcher */}
          {onStartTour && (
            <button
              onClick={onStartTour}
              title="Interactive Guided Tour (?)"
              aria-label="Start interactive guided tour"
              className={`shrink-0 flex items-center gap-1.5 border px-2 sm:px-2.5 py-1 font-mono text-[10px] sm:text-[11px] font-bold transition ${
                isTourRunning
                  ? "border-studio-orange bg-studio-orange text-carbon-950 shadow-sm shadow-studio-orange/30"
                  : "border-studio-orange/40 bg-studio-orange/10 text-studio-orange hover:bg-studio-orange/20"
              }`}
            >
              <Compass className={`h-3.5 w-3.5 shrink-0 ${!isTourRunning ? "animate-pulse" : ""}`} />
              <span className="hidden sm:inline">GUIDED TOUR</span>
              <span className="sm:hidden">TOUR</span>
            </button>
          )}

          {onRefreshCluster && (
            <button
              onClick={onRefreshCluster}
              title="Reset Cluster"
              aria-label="Reset cluster state"
              className="shrink-0 flex h-7 w-7 items-center justify-center border border-white/[0.08] bg-carbon-900/90 text-carbon-400 transition hover:border-studio-orange/50 hover:text-studio-orange"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
