"useStrictMode";
"use client";

import React, { useState, useEffect } from "react";
import { Activity, Shield, Cpu, RefreshCw, Zap, Server } from "lucide-react";

interface HeaderProps {
  clusterMode: "per-instance" | "shared";
  currentAlgorithm: string;
  isStreaming: boolean;
  onRefreshCluster?: () => void;
}

export function Header({
  clusterMode,
  currentAlgorithm,
  isStreaming,
  onRefreshCluster,
}: HeaderProps) {
  const [nodesAlive, setNodesAlive] = useState<number>(3);

  useEffect(() => {
    async function checkCluster() {
      try {
        const res = await fetch("/api/cluster/status");
        if (res.ok) {
          const data = await res.json();
          const alive = data.instances?.filter((i: any) => i.alive).length || 3;
          setNodesAlive(alive);
        }
      } catch {
        // Fallback
      }
    }
    checkCluster();
    const interval = setInterval(checkCluster, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-800/80 bg-cockpit-950/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 p-0.5 shadow-lg shadow-cyan-500/20">
            <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-slate-950">
              <Zap className="h-5 w-5 text-cyan-400" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-500" />
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-white font-mono">
                RATE<span className="text-cyan-400">LAB</span>
              </span>
              <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">
                v1.0 COCKPIT
              </span>
            </div>
            <p className="text-xs text-slate-400">Distributed Rate Limiter Telemetry</p>
          </div>
        </div>

        {/* Live Status Indicators */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Active Mode Pill */}
          <div className="hidden items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs sm:flex">
            <Shield className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-slate-400">Mode:</span>
            <span
              className={`font-semibold uppercase tracking-wider ${
                clusterMode === "shared" ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {clusterMode === "shared" ? "Shared (Redis Lua)" : "Per-Instance (Local)"}
            </span>
          </div>

          {/* Cluster Nodes Badge */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs">
            <Server className="h-3.5 w-3.5 text-cyan-400" />
            <span className="hidden text-slate-400 sm:inline">Cluster:</span>
            <span className="font-mono font-medium text-slate-200">
              {nodesAlive}/3 Nodes
            </span>
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
          </div>

          {/* SSE Telemetry Stream Badge */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs">
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <span className="hidden text-slate-400 sm:inline">SSE:</span>
            <span
              className={`font-mono text-xs font-semibold ${
                isStreaming ? "text-emerald-400" : "text-slate-400"
              }`}
            >
              {isStreaming ? "60 FPS LIVE" : "DISCONNECTED"}
            </span>
            <span
              className={`flex h-2 w-2 rounded-full ${
                isStreaming
                  ? "bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.9)]"
                  : "bg-slate-600"
              }`}
            />
          </div>

          {onRefreshCluster && (
            <button
              onClick={onRefreshCluster}
              aria-label="Refresh Cluster State"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/80 text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
