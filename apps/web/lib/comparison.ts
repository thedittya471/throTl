export interface AlgoResultLike {
  algorithm: string;
  allowed: number;
  total: number;
}

export interface ComparisonDataLike {
  scenario: string;
  limit: number;
  windowSizeMs: number;
  totalRequests: number;
  divergence: number;
  boundaryLeakDetected: boolean;
  algoA: AlgoResultLike;
  algoB: AlgoResultLike;
}

export interface ComparisonSummary {
  headline: string;
  signedDeltaText: string;
  detail: {
    isBoundaryLeak: boolean;
    leakedLabel?: string;
    leakedAllowed?: number;
    throttledLabel?: string;
    throttledAllowed?: number;
    windowSec: number;
    exploitPercent?: number;
    fallbackText?: string;
  };
}

export function formatComparisonSummary(
  data: ComparisonDataLike,
  getAlgoLabel: (id: string) => string
): ComparisonSummary {
  const metaA = getAlgoLabel(data.algoA.algorithm);
  const metaB = getAlgoLabel(data.algoB.algorithm);
  const windowSec = data.windowSizeMs / 1000;
  const signedDeltaText = data.divergence > 0 ? `+${data.divergence}` : `${data.divergence}`;

  const headline = data.boundaryLeakDetected
    ? "Boundary Burst Exploit Invariant: Leaked Traffic Detected"
    : data.divergence !== 0
    ? `Algorithmic Divergence: ${Math.abs(data.divergence)} Request Delta`
    : "Strict Mathematical Parity: Identical Enforcement";

  if (data.boundaryLeakDetected) {
    const isFixedA = data.algoA.algorithm === "fixed-window";
    const isFixedB = data.algoB.algorithm === "fixed-window";

    const leaked = isFixedA
      ? data.algoA
      : isFixedB
      ? data.algoB
      : data.algoA.allowed >= data.algoB.allowed
      ? data.algoA
      : data.algoB;

    const throttled = leaked === data.algoA ? data.algoB : data.algoA;

    const leakedLabel = getAlgoLabel(leaked.algorithm);
    const throttledLabel = getAlgoLabel(throttled.algorithm);
    const exploitPercent =
      data.limit > 0
        ? Math.round(((leaked.allowed - data.limit) / data.limit) * 100)
        : 100;

    return {
      headline,
      signedDeltaText,
      detail: {
        isBoundaryLeak: true,
        leakedLabel,
        leakedAllowed: leaked.allowed,
        throttledLabel,
        throttledAllowed: throttled.allowed,
        windowSec,
        exploitPercent,
      },
    };
  }

  let fallbackText = "";
  if (data.divergence !== 0) {
    fallbackText = `Under ${data.scenario} traffic, ${metaA} admitted ${data.algoA.allowed} requests while ${metaB} admitted ${data.algoB.allowed} requests.`;
  } else {
    fallbackText = `Both algorithms made identical admission decisions for all ${data.totalRequests} requests.`;
  }

  return {
    headline,
    signedDeltaText,
    detail: {
      isBoundaryLeak: false,
      windowSec,
      fallbackText,
    },
  };
}
