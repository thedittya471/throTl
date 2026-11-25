"useStrictMode";
"use client";

import React, { useEffect, useState } from "react";
import {
  Joyride,
  STATUS,
  type Step,
  type TooltipRenderProps,
  type EventData,
} from "react-joyride";
import { X, ChevronRight, ChevronLeft, Check, Compass } from "lucide-react";

interface GuidedTourProps {
  run: boolean;
  onFinish: () => void;
  onStepChange?: (stepIndex: number) => void;
}

const TOUR_STEPS: Step[] = [
  {
    target: '[data-tour="brand"]',
    title: "Welcome to throTl RateLab",
    content:
      "Ultra-high precision distributed rate limiting simulator & benchmark harness. This tour guides you through configuring, stress-testing, and benchmarking 5 rate limiting algorithms across a 3-node cluster.",
    placement: "bottom",
  },
  {
    target: '[data-tour="workflow-pipeline"]',
    title: "Streamlined 3-Phase Workflow",
    content:
      "Follow our structured pipeline: (1) Select Engine & Cluster Topology, (2) Synthesize Traffic or pick a Preset Scenario, and (3) Execute & Observe Live 60 FPS Telemetry.",
    placement: "bottom",
  },
  {
    target: '[data-tour="view-mode"]',
    title: "Cockpit vs Comparison Matrix",
    content:
      "Toggle between Cockpit Monitor (real-time telemetry & parameter tuning) and Comparison Matrix (automated side-by-side benchmark testing Boundary Burst, Cluster Coordination, and Latency invariants).",
    placement: "bottom",
  },
  {
    target: '[data-tour="algorithm-selection"]',
    title: "Step 1: Mathematical Engine Selection",
    content:
      "Choose from 5 mathematical algorithms: Fixed Window (O(1)), Sliding Log (100% boundary precision, O(N) memory), Sliding Window Counter (Cloudflare/Akamai standard), Token Bucket (burst capacity), or Leaky Bucket (smooth outflow).",
    placement: "bottom",
  },
  {
    target: '[data-tour="cluster-topology"]',
    title: "Step 1b: Cluster Topology & Coordination",
    content:
      "Compare 'Per-Instance' (isolated process memory, permits 3x over-admission) with 'Shared Redis' (atomic EVALSHA Lua scripts, strict cluster-wide limit enforcement).",
    placement: "right",
  },
  {
    target: '[data-tour="preset-scenarios"]',
    title: "Step 2: Preset Attack Scenarios",
    content:
      "Quickly simulate real-world attacks with deterministic seeds: Login Brute Force (1 abuser IP), Search Traffic Surge (500 clients), Webhook Retries, or Heavy File Uploads.",
    placement: "top",
  },
  {
    target: '[data-tour="traffic-params"]',
    title: "Step 2b: Traffic Synthesizer",
    content:
      "Fine-tune throughput up to 1,000 req/s, scale virtual client pools from 1 to 1,000, and simulate traffic arrival curves (Steady, Burst, Ramp-up, Sawtooth, Boundary Attack, or Heavy Abuser).",
    placement: "left",
  },
  {
    target: '[data-tour="execution-bar"]',
    title: "Step 3: Execution Controls & Shortcuts",
    content:
      "Run the benchmark, pause for microsecond frame inspection, halt, or flush cluster counters. Pro-tip: Press [Space] to Run/Pause, [R] to Reset, and [?] anytime to reopen this tour.",
    placement: "top",
  },
  {
    target: '[data-tour="telemetry-timeline"]',
    title: "Live 60 FPS Telemetry Canvas",
    content:
      "Decoupled HTML5 canvas streaming 100ms ticks. Green bars indicate admitted requests, red shows 429 Too Many Requests, plotted alongside sub-millisecond P50 and P99 latencies.",
    placement: "top",
  },
  {
    target: '[data-tour="instance-gauges"]',
    title: "Cluster Load Distribution",
    content:
      "Inspect round-robin traffic routing and individual quota consumption across Node-01 (:4001), Node-02 (:4002), and Node-03 (:4003).",
    placement: "top",
  },
  {
    target: '[data-tour="algorithm-inspector"]',
    title: "Internal State Inspector",
    content:
      "Peek directly into internal algorithm memory—inspect rolling timestamps, remaining token balances, or leaky bucket queue depth in real time.",
    placement: "top",
  },
];

function StudioTourTooltip({
  continuous,
  index,
  step,
  backProps,
  closeProps,
  primaryProps,
  skipProps,
  isLastStep,
  size,
}: TooltipRenderProps) {
  return (
    <div
      className="w-[340px] sm:w-[420px] rounded-sm border border-studio-orange/70 bg-carbon-950 p-5 font-mono text-carbon-100 shadow-2xl shadow-studio-orange/20 studio-card corner-crosshair"
      style={{ zIndex: 10000 }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 mb-3">
        <div className="flex items-center gap-2 text-[10px] text-studio-orange font-bold uppercase tracking-wider">
          <Compass className="h-3.5 w-3.5 text-studio-orange" />
          <span>[ STEP {index + 1} OF {size} ]</span>
        </div>

        <button
          {...closeProps}
          title="Exit Tour"
          className="text-carbon-500 hover:text-white transition p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Title */}
      <h3 className="font-sans text-base font-bold text-white tracking-tight mb-2">
        {step.title}
      </h3>

      {/* Content */}
      <div className="font-sans text-xs text-carbon-300 leading-relaxed mb-5">
        {step.content}
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-1 mb-4">
        {Array.from({ length: size }).map((_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 transition-all ${
              i === index
                ? "bg-studio-orange shadow-[0_0_6px_rgba(255,84,0,0.8)]"
                : i < index
                ? "bg-white/30"
                : "bg-white/10"
            }`}
          />
        ))}
      </div>

      {/* Footer controls */}
      <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
        <button
          {...skipProps}
          className="text-[10px] uppercase tracking-wider text-carbon-500 hover:text-carbon-300 transition"
        >
          Skip Tour
        </button>

        <div className="flex items-center gap-2">
          {index > 0 && (
            <button
              {...backProps}
              className="flex items-center gap-1 border border-white/[0.1] bg-carbon-900 px-3 py-1.5 text-[11px] font-bold text-carbon-300 uppercase tracking-wider hover:border-white/20 hover:text-white transition"
            >
              <ChevronLeft className="h-3 w-3" />
              Back
            </button>
          )}

          <button
            {...primaryProps}
            className="flex items-center gap-1.5 bg-studio-orange px-4 py-1.5 text-[11px] font-black text-carbon-950 uppercase tracking-wider hover:bg-studio-orangeHover transition shadow-md shadow-studio-orange/20"
          >
            {isLastStep ? (
              <>
                <span>Finish</span>
                <Check className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function GuidedTour({ run, onFinish, onStepChange }: GuidedTourProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const handleJoyrideEvent = (data: EventData) => {
    const { status, index } = data;

    if (onStepChange) {
      onStepChange(index);
    }

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      if (typeof window !== "undefined") {
        localStorage.setItem("ratelab_tour_completed", "true");
      }
      onFinish();
    }
  };

  return (
    <Joyride
      steps={TOUR_STEPS}
      run={run}
      continuous
      scrollToFirstStep
      tooltipComponent={StudioTourTooltip}
      onEvent={handleJoyrideEvent}
      options={{
        overlayColor: "rgba(6, 6, 8, 0.78)",
        primaryColor: "#FF5400",
        zIndex: 10000,
        spotlightRadius: 4,
        skipBeacon: true,
      }}
    />
  );
}
