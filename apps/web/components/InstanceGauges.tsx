"useStrictMode";
"use client";

import React from "react";
import { Server, Activity, ShieldAlert, ShieldCheck } from "lucide-react";

export interface InstanceStatsData {
  total: number;
  allowed: number;
  rejected: number;
}

interface InstanceGaugesProps {
  distribution?: Record<string, InstanceStatsData> | null;
  mode: "per-instance" | "shared";
  limit?: number;
}

const NODES = [
  { id: "instance-1", port: 4071, label: "NODE-01" },
  { id: "instance-2", port: 4072, label: "NODE-02" },
  { id: "instance-3", port: 4073, label: "NODE-03" },
];

export function InstanceGauges({
  distribution,
  mode,
  limit = 100,
}: InstanceGaugesProps) {
  // Aggregate total cluster traffic across nodes
  let totalClusterReqs = 0;
  if (distribution) {
    for (const k of Object.keys(distribution)) {
      totalClusterReqs += distribution[k].total;
    }
  }

  return (
    <div data-tour="instance-gauges" className="studio-card corner-crosshair p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-studio-orange font-bold">[ 06 ]</span>
          <span className="font-semibold uppercase tracking-wider text-white">
            Cluster Load Distribution
          </span>
        </div>
        <span className="text-carbon-500">ROUND-ROBIN DISPATCH</span>
      </div>

      {/* Mode Coordination Indicator Banner */}
      <div
        className={`border p-2.5 font-mono text-[10px] leading-tight flex items-start gap-2 ${
          mode === "shared"
            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
            : "border-amber-500/30 bg-amber-500/5 text-amber-300"
        }`}
      >
        {mode === "shared" ? (
          <>
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400 mt-0.5" />
            <div>
              <span className="font-bold uppercase tracking-wider">SHARED REDIS SYNCHRONIZATION: </span>
              State is shared globally across all 3 nodes via atomic Lua scripts. Cluster is strictly capped at {limit} reqs.
            </div>
          </>
        ) : (
          <>
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
            <div>
              <span className="font-bold uppercase tracking-wider">INDEPENDENT ISOLATED QUOTAS: </span>
              Each node maintains its own local memory limit of {limit} reqs. 300 requests distributed 3-ways are over-admitted (300 allowed).
            </div>
          </>
        )}
      </div>

      {/* 3-Instance Gauges Grid */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {NODES.map((node) => {
          const stats = distribution?.[node.id] || { total: 0, allowed: 0, rejected: 0 };
          const sharePercent = totalClusterReqs > 0 ? (stats.total / totalClusterReqs) * 100 : 33.3;
          const allowedRatio = stats.total > 0 ? (stats.allowed / stats.total) * 100 : 100;

          return (
            <div
              key={node.id}
              className="border border-white/[0.06] bg-carbon-950 p-3.5 font-mono space-y-2.5"
            >
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 font-bold text-white">
                  <Server className="h-3.5 w-3.5 text-studio-orange" />
                  <span>{node.label}</span>
                </div>
                <span className="text-[10px] text-carbon-500">:{node.port}</span>
              </div>

              {/* Load Share Meter */}
              <div>
                <div className="flex justify-between text-[9px] text-carbon-400 uppercase mb-1">
                  <span>Cluster Share</span>
                  <span className="text-white font-bold">{sharePercent.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 w-full bg-carbon-900 border border-white/[0.04]">
                  <div
                    className="h-full bg-studio-orange transition-all duration-300"
                    style={{ width: `${Math.min(100, sharePercent)}%` }}
                  />
                </div>
              </div>

              {/* Status & Counts */}
              <div className="border-t border-white/[0.05] pt-2 space-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-carbon-500">ALLOWED:</span>
                  <span className="font-bold text-emerald-400">{stats.allowed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-carbon-500">REJECTED:</span>
                  <span className="font-bold text-studio-orange">{stats.rejected}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-carbon-500">TOTAL:</span>
                  <span className="font-bold text-white">{stats.total}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
