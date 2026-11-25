import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatComparisonSummary, type ComparisonDataLike } from "../lib/comparison.js";

const ALGO_LABELS: Record<string, string> = {
  "fixed-window": "Fixed Window",
  "sliding-log": "Sliding Log",
  "sliding-window-counter": "Sliding Counter",
  "token-bucket": "Token Bucket",
  "leaky-bucket": "Leaky Bucket",
};

const getLabel = (id: string) => ALGO_LABELS[id] || id;

describe("Comparison Matrix Attribution & Replay Parameters", () => {
  it("renders 200 Fixed Window admissions and 100 Sliding Counter admissions in default order with +100 delta", () => {
    const data: ComparisonDataLike = {
      scenario: "window-boundary",
      limit: 100,
      windowSizeMs: 60000,
      totalRequests: 200,
      divergence: 100, // Alpha (200) - Beta (100)
      boundaryLeakDetected: true,
      algoA: { algorithm: "fixed-window", allowed: 200, total: 200 },
      algoB: { algorithm: "sliding-window-counter", allowed: 100, total: 200 },
    };

    const result = formatComparisonSummary(data, getLabel);

    assert.equal(result.signedDeltaText, "+100");
    assert.equal(result.detail.isBoundaryLeak, true);
    assert.equal(result.detail.leakedLabel, "Fixed Window");
    assert.equal(result.detail.leakedAllowed, 200);
    assert.equal(result.detail.throttledLabel, "Sliding Counter");
    assert.equal(result.detail.throttledAllowed, 100);
    assert.equal(result.detail.windowSec, 60);
    assert.equal(result.detail.exploitPercent, 100);
  });

  it("renders 200 Fixed Window admissions and 100 Sliding Counter admissions in swapped order with -100 delta", () => {
    const data: ComparisonDataLike = {
      scenario: "window-boundary",
      limit: 100,
      windowSizeMs: 60000,
      totalRequests: 200,
      divergence: -100, // Alpha (100) - Beta (200)
      boundaryLeakDetected: true,
      algoA: { algorithm: "sliding-window-counter", allowed: 100, total: 200 },
      algoB: { algorithm: "fixed-window", allowed: 200, total: 200 },
    };

    const result = formatComparisonSummary(data, getLabel);

    assert.equal(result.signedDeltaText, "-100");
    assert.equal(result.detail.isBoundaryLeak, true);
    assert.equal(result.detail.leakedLabel, "Fixed Window");
    assert.equal(result.detail.leakedAllowed, 200);
    assert.equal(result.detail.throttledLabel, "Sliding Counter");
    assert.equal(result.detail.throttledAllowed, 100);
    assert.equal(result.detail.windowSec, 60);
  });

  it("renders the actual pair and window for alternate combination: Fixed Window vs Sliding Log with 30s window", () => {
    const data: ComparisonDataLike = {
      scenario: "window-boundary",
      limit: 50,
      windowSizeMs: 30000,
      totalRequests: 100,
      divergence: 50,
      boundaryLeakDetected: true,
      algoA: { algorithm: "fixed-window", allowed: 100, total: 100 },
      algoB: { algorithm: "sliding-log", allowed: 50, total: 100 },
    };

    const result = formatComparisonSummary(data, getLabel);

    assert.equal(result.signedDeltaText, "+50");
    assert.equal(result.detail.leakedLabel, "Fixed Window");
    assert.equal(result.detail.leakedAllowed, 100);
    assert.equal(result.detail.throttledLabel, "Sliding Log");
    assert.equal(result.detail.throttledAllowed, 50);
    assert.equal(result.detail.windowSec, 30);
    assert.equal(result.detail.exploitPercent, 100);
  });

  it("handles non-boundary scenario divergence reporting actual algorithm labels", () => {
    const data: ComparisonDataLike = {
      scenario: "burst-spike",
      limit: 100,
      windowSizeMs: 60000,
      totalRequests: 250,
      divergence: 25,
      boundaryLeakDetected: false,
      algoA: { algorithm: "token-bucket", allowed: 200, total: 250 },
      algoB: { algorithm: "leaky-bucket", allowed: 175, total: 250 },
    };

    const result = formatComparisonSummary(data, getLabel);

    assert.equal(result.detail.isBoundaryLeak, false);
    assert.equal(result.signedDeltaText, "+25");
    assert.match(result.detail.fallbackText || "", /Token Bucket admitted 200/);
    assert.match(result.detail.fallbackText || "", /Leaky Bucket admitted 175/);
  });
});
