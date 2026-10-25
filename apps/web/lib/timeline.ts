import type { RunTelemetry } from '@ratelab/contracts';

export function buildTimeline(points: RunTelemetry['timeline']) {
  const startMs = points[0]?.elapsedMs ?? 0;
  const endMs = (points.at(-1)?.elapsedMs ?? startMs) + 1_000;
  const maxCount = Math.max(1, ...points.map((point) => point.allowed + point.rejected));
  const scale = 140 / maxCount;
  const width = Math.max(1, 560 * 1_000 / (endMs - startMs) - 1);
  const bars = points.map((point) => ({
    ...point,
    x: 35 + (point.elapsedMs - startMs) / (endMs - startMs) * 560,
    width,
    allowedHeight: point.allowed * scale,
    rejectedHeight: point.rejected * scale,
  }));
  return { bars, startMs, endMs, maxCount };
}
