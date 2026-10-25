import { CONTRACT_VERSION, type FixedWindowDemoResponse } from '@ratelab/contracts';
import { Router, type Response } from 'express';
import { createFixedWindowLimiter } from './limiters/fixed-window.ts';

export type DemoOptions = {
  limit?: number;
  windowMs?: number;
  now?: () => number;
  instanceId?: string;
};

export function createDemoRouter({ limit = 100, windowMs = 60_000, now = Date.now, instanceId = 'local' }: DemoOptions = {}) {
  const router = Router();
  const limiter = createFixedWindowLimiter({ limit, windowMs, now });

  router.all('/', (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.set('Allow', 'GET').status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    if (request.originalUrl.includes('?')) {
      response.status(400).json({ error: 'DEMO_QUERY_NOT_SUPPORTED' });
      return;
    }

    // One server-owned key keeps this standalone demo's memory bounded.
    const decision = limiter.check('global');
    sendFixedWindowDecision(response, decision, instanceId);
  });

  return router;
}

export function sendFixedWindowDecision(response: Response, decision: FixedWindowDemoResponse['decision'], instanceId = 'local') {
  response.set({
    'X-RateLab-Algorithm': 'fixed-window',
    'X-RateLab-Instance': instanceId,
    'X-RateLab-Decision': decision.allowed ? 'allowed' : 'rejected',
    'X-RateLab-Limit': String(decision.state.limit),
    'X-RateLab-Remaining': String(decision.remaining),
    'X-RateLab-Reset-Ms': String(decision.resetAtMs),
  });
  if (!decision.allowed) {
    response.set('Retry-After', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1_000))));
  }
  response.status(decision.allowed ? 200 : 429).json({
    version: CONTRACT_VERSION,
    algorithm: 'fixed-window',
    instance: instanceId,
    decision,
  } satisfies FixedWindowDemoResponse);
}
