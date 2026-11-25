"useStrictMode";
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Activity, ShieldCheck, ShieldAlert, Cpu, Maximize2, Pause, Play, RotateCcw } from "lucide-react";

export interface TimelinePoint {
  timestampMs: number;
  allowedCount: number;
  rejectedCount: number;
  totalCount: number;
  limit: number;
  p50LatencyNs: number;
  p99LatencyNs: number;
}

interface TimelineVisualizerProps {
  latestTick?: {
    tickId: number;
    timestampMs: number;
    totalCount: number;
    allowedCount: number;
    rejectedCount: number;
    windowDurationMs: number;
    p50LatencyNs?: number;
    p99LatencyNs?: number;
    limit?: number;
  } | null;
  limit?: number;
  isStreaming?: boolean;
}

export function TimelineVisualizer({
  latestTick,
  limit = 100,
  isStreaming = false,
}: TimelineVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bufferRef = useRef<TimelinePoint[]>([]);
  const animFrameRef = useRef<number | null>(null);

  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [measuredFps, setMeasuredFps] = useState<number>(60);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  const maxPoints = 80;

  // Initialize buffer with flat baseline
  useEffect(() => {
    const now = Date.now();
    const initial: TimelinePoint[] = [];
    for (let i = maxPoints; i >= 0; i--) {
      initial.push({
        timestampMs: now - i * 100,
        allowedCount: 0,
        rejectedCount: 0,
        totalCount: 0,
        limit,
        p50LatencyNs: 0,
        p99LatencyNs: 0,
      });
    }
    bufferRef.current = initial;
  }, [limit]);

  // Ingest new tick
  useEffect(() => {
    if (!latestTick || isPaused) return;

    const point: TimelinePoint = {
      timestampMs: latestTick.timestampMs,
      allowedCount: latestTick.allowedCount || 0,
      rejectedCount: latestTick.rejectedCount || 0,
      totalCount: latestTick.totalCount || 0,
      limit: latestTick.limit || limit,
      p50LatencyNs: latestTick.p50LatencyNs || 0,
      p99LatencyNs: latestTick.p99LatencyNs || 0,
    };

    bufferRef.current.push(point);
    if (bufferRef.current.length > maxPoints) {
      bufferRef.current.shift();
    }
  }, [latestTick, limit, isPaused]);

  // Decoupled 60fps Canvas Render Loop
  useEffect(() => {
    let lastTime = performance.now();
    let frameCount = 0;
    let lastFpsUpdate = lastTime;

    const render = (time: number) => {
      // FPS measurement
      frameCount++;
      if (time - lastFpsUpdate >= 500) {
        setMeasuredFps(Math.round((frameCount * 1000) / (time - lastFpsUpdate)));
        frameCount = 0;
        lastFpsUpdate = time;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          drawCanvas(ctx, canvas, bufferRef.current, limit, hoverIndex);
        }
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [limit, hoverIndex]);

  const drawCanvas = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    data: TimelinePoint[],
    currentLimit: number,
    hoveredIdx: number | null
  ) => {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.clearRect(0, 0, width, height);

    if (data.length < 2) return;

    // Determine max Y scale
    let maxVal = currentLimit * 1.25;
    for (const p of data) {
      if (p.totalCount > maxVal) maxVal = p.totalCount * 1.15;
    }
    maxVal = Math.max(maxVal, 20);

    const padLeft = 40;
    const padRight = 15;
    const padTop = 20;
    const padBottom = 25;

    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const getX = (i: number) => padLeft + (i / (data.length - 1)) * plotW;
    const getY = (val: number) => padTop + plotH - (val / maxVal) * plotH;

    // 1. Grid Lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.fillStyle = "#525266";
    ctx.font = "9px monospace";
    ctx.textAlign = "right";

    const gridSteps = 4;
    for (let s = 0; s <= gridSteps; s++) {
      const val = Math.round((maxVal / gridSteps) * s);
      const y = getY(val);

      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();

      ctx.fillText(String(val), padLeft - 6, y + 3);
    }

    // 2. Limit Threshold Line
    const limitY = getY(currentLimit);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(245, 158, 11, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, limitY);
    ctx.lineTo(width - padRight, limitY);
    ctx.stroke();

    ctx.fillStyle = "#f59e0b";
    ctx.textAlign = "left";
    ctx.fillText(`LIMIT: ${currentLimit}`, width - padRight - 75, limitY - 4);
    ctx.restore();

    // 3. Draw Allowed Requests Area & Stepped Stroke (Emerald)
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(0));
    for (let i = 0; i < data.length; i++) {
      const x = getX(i);
      const y = getY(data[i].allowedCount);
      if (i === 0) {
        ctx.lineTo(x, y);
      } else {
        const prevX = getX(i - 1);
        ctx.lineTo(x, getY(data[i - 1].allowedCount));
        ctx.lineTo(x, y);
      }
    }
    ctx.lineTo(getX(data.length - 1), getY(0));
    ctx.closePath();

    const allowedGrad = ctx.createLinearGradient(0, padTop, 0, height - padBottom);
    allowedGrad.addColorStop(0, "rgba(16, 185, 129, 0.2)");
    allowedGrad.addColorStop(1, "rgba(16, 185, 129, 0.0)");
    ctx.fillStyle = allowedGrad;
    ctx.fill();

    // Allowed Stroke
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = getX(i);
      const y = getY(data[i].allowedCount);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, getY(data[i - 1].allowedCount));
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 4. Draw Rejected Requests Area & Stepped Stroke (Studio Orange)
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(0));
    for (let i = 0; i < data.length; i++) {
      const x = getX(i);
      const y = getY(data[i].rejectedCount);
      if (i === 0) {
        ctx.lineTo(x, y);
      } else {
        ctx.lineTo(x, getY(data[i - 1].rejectedCount));
        ctx.lineTo(x, y);
      }
    }
    ctx.lineTo(getX(data.length - 1), getY(0));
    ctx.closePath();

    const rejectedGrad = ctx.createLinearGradient(0, padTop, 0, height - padBottom);
    rejectedGrad.addColorStop(0, "rgba(255, 84, 0, 0.35)");
    rejectedGrad.addColorStop(1, "rgba(255, 84, 0, 0.0)");
    ctx.fillStyle = rejectedGrad;
    ctx.fill();

    // Rejected Stroke
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = getX(i);
      const y = getY(data[i].rejectedCount);
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, getY(data[i - 1].rejectedCount));
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = "#FF5400";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 5. Draw Pulse Indicator at Head (latest point)
    const lastX = getX(data.length - 1);
    const lastAllowedY = getY(data[data.length - 1].allowedCount);
    const lastRejectedY = getY(data[data.length - 1].rejectedCount);

    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(lastX, lastAllowedY, 3, 0, Math.PI * 2);
    ctx.fill();

    if (data[data.length - 1].rejectedCount > 0) {
      ctx.fillStyle = "#FF5400";
      ctx.beginPath();
      ctx.arc(lastX, lastRejectedY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Crosshair on Hover
    if (hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < data.length) {
      const hx = getX(hoveredIdx);
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(hx, padTop);
      ctx.lineTo(hx, height - padBottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  // Resize canvas to match display size
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();

      canvas.width = rect.width * dpr;
      canvas.height = 240 * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `240px`;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const padLeft = 40;
    const padRight = 15;
    const plotW = rect.width - padLeft - padRight;
    const dataLen = bufferRef.current.length;

    if (x >= padLeft && x <= rect.width - padRight && dataLen > 1) {
      const idx = Math.round(((x - padLeft) / plotW) * (dataLen - 1));
      setHoverIndex(idx);
      setHoverPos({ x: e.clientX, y: e.clientY });
    } else {
      setHoverIndex(null);
      setHoverPos(null);
    }
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
    setHoverPos(null);
  };

  const latestData = bufferRef.current[bufferRef.current.length - 1];

  return (
    <div className="studio-card corner-crosshair p-5 space-y-3">
      {/* HUD Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/[0.06] pb-3 gap-2">
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-studio-orange font-bold">[ 05 ]</span>
          <span className="font-semibold uppercase tracking-wider text-white">
            60 FPS Live Telemetry Timeline
          </span>
          <span className="text-carbon-500 hidden sm:inline">// 100ms Ticks</span>
        </div>

        {/* Live Metrics Readout */}
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
          <div className="flex items-center gap-1.5 border border-white/[0.06] bg-carbon-950 px-2.5 py-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
            <span className="text-carbon-500">ALLOWED:</span>
            <span className="font-bold text-emerald-400">
              {latestData?.allowedCount || 0}
            </span>
          </div>

          <div className="flex items-center gap-1.5 border border-white/[0.06] bg-carbon-950 px-2.5 py-1">
            <span className="h-2 w-2 rounded-full bg-studio-orange shadow-[0_0_6px_rgba(255,84,0,0.8)]" />
            <span className="text-carbon-500">REJECTED:</span>
            <span className="font-bold text-studio-orange">
              {latestData?.rejectedCount || 0}
            </span>
          </div>

          <div className="flex items-center gap-1.5 border border-white/[0.06] bg-carbon-950 px-2.5 py-1 text-carbon-400">
            <Activity className="h-3 w-3 text-cyan-400" />
            <span>RENDER:</span>
            <span className="font-bold text-white">{measuredFps} FPS</span>
          </div>

          {/* Pause / Clear Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsPaused(!isPaused)}
              title={isPaused ? "Resume Timeline" : "Pause Timeline"}
              className="p-1 border border-white/[0.08] bg-carbon-900 text-carbon-400 hover:text-white"
            >
              {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            </button>
            <button
              onClick={() => {
                const now = Date.now();
                bufferRef.current = bufferRef.current.map((p, i) => ({
                  ...p,
                  allowedCount: 0,
                  rejectedCount: 0,
                  totalCount: 0,
                  timestampMs: now - (maxPoints - i) * 100,
                }));
              }}
              title="Reset Timeline Buffer"
              className="p-1 border border-white/[0.08] bg-carbon-900 text-carbon-400 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Canvas Chart Area */}
      <div ref={containerRef} className="relative w-full overflow-hidden bg-carbon-950/70 border border-white/[0.05]">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="cursor-crosshair block w-full"
        />

        {/* Floating Tooltip */}
        {hoverIndex !== null && hoverPos && bufferRef.current[hoverIndex] && (
          <div
            className="pointer-events-none absolute z-20 border border-white/[0.12] bg-carbon-900/95 p-2 font-mono text-[10px] shadow-2xl backdrop-blur-md"
            style={{
              left: Math.min(window.innerWidth - 200, hoverPos.x + 12),
              top: 15,
            }}
          >
            <div className="text-carbon-400 border-b border-white/[0.06] pb-1 mb-1">
              {new Date(bufferRef.current[hoverIndex].timestampMs).toLocaleTimeString()}
            </div>
            <div className="text-emerald-400">
              ALLOWED: {bufferRef.current[hoverIndex].allowedCount}
            </div>
            <div className="text-studio-orange">
              REJECTED: {bufferRef.current[hoverIndex].rejectedCount}
            </div>
            <div className="text-white">
              TOTAL: {bufferRef.current[hoverIndex].totalCount}
            </div>
          </div>
        )}
      </div>

      {/* Legend & Stream Telemetry */}
      <div className="flex flex-wrap items-center justify-between font-mono text-[10px] text-carbon-500 pt-1">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-emerald-500 rounded-sm inline-block" />
            <span className="text-carbon-400 font-medium">ALLOWED REQUESTS (200 OK)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-studio-orange rounded-sm inline-block" />
            <span className="text-carbon-400 font-medium">BLOCKED REQUESTS (429 TOO MANY)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 border-b border-dashed border-amber-400 inline-block" />
            <span className="text-carbon-400 font-medium">RATE LIMIT THRESHOLD</span>
          </div>
        </div>

        <div className="text-carbon-500">
          DECOUPLED CANVAS 2D // ZERO EVENT LOOP BLOCKING
        </div>
      </div>
    </div>
  );
}
