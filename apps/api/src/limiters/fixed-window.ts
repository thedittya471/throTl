import type { Limiter } from './types.ts';

type FixedWindowOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

type WindowCounter = {
  windowStartMs: number;
  count: number;
  lastEffectiveTimeMs: number;
};

type FixedWindowState = {
  limit: number;
  windowStartMs: number;
  countBefore: number;
  countAfter: number;
  rawTimeMs: number;
  effectiveTimeMs: number;
  clockClamped: boolean;
};

export function createFixedWindowLimiter({
  limit,
  windowMs,
  now = Date.now,
}: FixedWindowOptions): Limiter<FixedWindowState> {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('limit must be a positive safe integer');
  }
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
    throw new Error('windowMs must be a positive safe integer');
  }

  // shortcut: keys live for this instance's lifetime; dispose of it when its experiment ends.
  const windowsByKey = new Map<string, WindowCounter>();

  return {
    check(key) {
      if (typeof key !== 'string' || key.length === 0) {
        throw new Error('key must be a non-empty string');
      }

      const rawTimeMs = now();
      if (!Number.isSafeInteger(rawTimeMs) || rawTimeMs < 0) {
        throw new Error('clock must return non-negative safe integer milliseconds');
      }

      const previousWindow = windowsByKey.get(key);
      const effectiveTimeMs = Math.max(rawTimeMs, previousWindow?.lastEffectiveTimeMs ?? rawTimeMs);

      const windowStartMs = effectiveTimeMs - (effectiveTimeMs % windowMs);
      const resetAtMs = windowStartMs + windowMs;
      if (!Number.isSafeInteger(resetAtMs)) {
        throw new Error('window reset exceeds the safe timestamp range');
      }

      const countBefore = previousWindow?.windowStartMs === windowStartMs
        ? previousWindow.count
        : 0;
      const allowed = countBefore < limit;
      const countAfter = allowed ? countBefore + 1 : countBefore;

      windowsByKey.set(key, {
        windowStartMs,
        count: countAfter,
        lastEffectiveTimeMs: effectiveTimeMs,
      });

      return {
        allowed,
        reason: allowed ? 'within_limit' : 'limit_exhausted',
        remaining: limit - countAfter,
        resetAtMs,
        // Include the rollback gap so a retry does not arrive before the raw clock reaches reset.
        retryAfterMs: allowed ? 0 : resetAtMs - rawTimeMs,
        state: {
          limit,
          windowStartMs,
          countBefore,
          countAfter,
          rawTimeMs,
          effectiveTimeMs,
          clockClamped: effectiveTimeMs !== rawTimeMs,
        },
      };
    },
  };
}
