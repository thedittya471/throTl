"useStrictMode";
"use client";

import React from "react";
import { Cpu, Clock, Layers, Waves, Droplet, Hash, ArrowDown } from "lucide-react";
import type { AlgorithmType } from "./ControlPanel";

interface AlgorithmStateCardProps {
  algorithm: AlgorithmType;
  stateSnapshot?: Record<string, any> | null;
  limit?: number;
  windowSizeMs?: number;
}

export function AlgorithmStateCard({
  algorithm,
  stateSnapshot,
  limit = 100,
  windowSizeMs = 60000,
}: AlgorithmStateCardProps) {
  return (
    <div className="studio-card corner-crosshair p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 font-mono text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-studio-orange font-bold">[ 07 ]</span>
          <span className="font-semibold uppercase tracking-wider text-white">
            Internal Algorithm Inspector
          </span>
        </div>
        <span className="text-carbon-500 font-bold uppercase">{algorithm}</span>
      </div>

      {/* Dynamic Inspector based on Algorithm Type */}
      <div className="font-mono text-[11px] space-y-3">
        {algorithm === "fixed-window" && (
          <div className="space-y-3">
            <div className="border border-white/[0.06] bg-carbon-950 p-3 space-y-2">
              <div className="flex justify-between text-[10px] text-carbon-400 uppercase">
                <span>Current Window Counter</span>
                <span className="text-white font-bold">
                  {stateSnapshot?.count ?? 0} / {limit}
                </span>
              </div>
              <div className="h-2 w-full bg-carbon-900 border border-white/[0.04]">
                <div
                  className="h-full bg-studio-orange transition-all duration-200"
                  style={{
                    width: `${Math.min(100, (((stateSnapshot?.count ?? 0)) / limit) * 100)}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="border border-white/[0.06] bg-carbon-950 p-2.5">
                <span className="text-carbon-500 block">WINDOW SIZE:</span>
                <span className="text-white font-bold">{windowSizeMs / 1000}s</span>
              </div>
              <div className="border border-white/[0.06] bg-carbon-950 p-2.5">
                <span className="text-carbon-500 block">BOUNDARY RISK:</span>
                <span className="text-amber-400 font-bold">200 REQS / 2X</span>
              </div>
            </div>
          </div>
        )}

        {algorithm === "sliding-log" && (
          <div className="space-y-3">
            <div className="border border-white/[0.06] bg-carbon-950 p-3 space-y-2">
              <div className="flex justify-between text-[10px] text-carbon-400 uppercase">
                <span>Timestamps in Memory Deque</span>
                <span className="text-white font-bold">
                  {stateSnapshot?.logSize ?? stateSnapshot?.currentCount ?? 0} Entries
                </span>
              </div>
              <div className="h-2 w-full bg-carbon-900 border border-white/[0.04]">
                <div
                  className="h-full bg-studio-orange transition-all duration-200"
                  style={{
                    width: `${Math.min(
                      100,
                      (((stateSnapshot?.logSize ?? stateSnapshot?.currentCount ?? 0)) / limit) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="border border-white/[0.06] bg-carbon-950 p-2.5">
                <span className="text-carbon-500 block">PRECISION:</span>
                <span className="text-emerald-400 font-bold">100% STRICT</span>
              </div>
              <div className="border border-white/[0.06] bg-carbon-950 p-2.5">
                <span className="text-carbon-500 block">MEMORY OVERHEAD:</span>
                <span className="text-carbon-300 font-bold">O(N) TIMESTAMPS</span>
              </div>
            </div>
          </div>
        )}

        {algorithm === "sliding-window-counter" && (
          <div className="space-y-3">
            <div className="border border-white/[0.06] bg-carbon-950 p-3 space-y-2">
              <div className="flex justify-between text-[10px] text-carbon-400 uppercase">
                <span>Weighted Window Estimate</span>
                <span className="text-white font-bold">
                  {stateSnapshot?.estimatedCount ?? 0} / {limit}
                </span>
              </div>
              <div className="h-2 w-full bg-carbon-900 border border-white/[0.04]">
                <div
                  className="h-full bg-studio-orange transition-all duration-200"
                  style={{
                    width: `${Math.min(
                      100,
                      (((stateSnapshot?.estimatedCount ?? 0)) / limit) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="border border-white/[0.06] bg-carbon-950 p-2.5">
                <span className="text-carbon-500 block">PREV WINDOW:</span>
                <span className="text-white font-bold">{stateSnapshot?.prevCount ?? 0} reqs</span>
              </div>
              <div className="border border-white/[0.06] bg-carbon-950 p-2.5">
                <span className="text-carbon-500 block">CURR WINDOW:</span>
                <span className="text-white font-bold">{stateSnapshot?.currCount ?? 0} reqs</span>
              </div>
            </div>
          </div>
        )}

        {algorithm === "token-bucket" && (
          <div className="space-y-3">
            <div className="border border-white/[0.06] bg-carbon-950 p-3 space-y-2">
              <div className="flex justify-between text-[10px] text-carbon-400 uppercase">
                <span>Tokens in Bucket</span>
                <span className="text-emerald-400 font-bold">
                  {stateSnapshot?.tokens ?? limit} / {limit}
                </span>
              </div>
              <div className="h-2 w-full bg-carbon-900 border border-white/[0.04]">
                <div
                  className="h-full bg-emerald-400 transition-all duration-200"
                  style={{
                    width: `${Math.min(
                      100,
                      (((stateSnapshot?.tokens ?? limit)) / limit) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="border border-white/[0.06] bg-carbon-950 p-2.5">
                <span className="text-carbon-500 block">REFILL SPEED:</span>
                <span className="text-white font-bold">
                  {stateSnapshot?.refillRatePerSec ?? 10} tokens/sec
                </span>
              </div>
              <div className="border border-white/[0.06] bg-carbon-950 p-2.5">
                <span className="text-carbon-500 block">BURST CAPACITY:</span>
                <span className="text-studio-orange font-bold">ALLOWED ({limit})</span>
              </div>
            </div>
          </div>
        )}

        {algorithm === "leaky-bucket" && (
          <div className="space-y-3">
            <div className="border border-white/[0.06] bg-carbon-950 p-3 space-y-2">
              <div className="flex justify-between text-[10px] text-carbon-400 uppercase">
                <span>Queue Water Level</span>
                <span className="text-studio-orange font-bold">
                  {stateSnapshot?.level ?? 0} / {limit}
                </span>
              </div>
              <div className="h-2 w-full bg-carbon-900 border border-white/[0.04]">
                <div
                  className="h-full bg-studio-orange transition-all duration-200"
                  style={{
                    width: `${Math.min(
                      100,
                      (((stateSnapshot?.level ?? 0)) / limit) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="border border-white/[0.06] bg-carbon-950 p-2.5">
                <span className="text-carbon-500 block">LEAK RATE:</span>
                <span className="text-white font-bold">
                  {stateSnapshot?.leakRatePerSec ?? 10} req/sec
                </span>
              </div>
              <div className="border border-white/[0.06] bg-carbon-950 p-2.5">
                <span className="text-carbon-500 block">TRAFFIC SHAPING:</span>
                <span className="text-emerald-400 font-bold">SMOOTH OUTFLOW</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
