import { timingSafeEqual } from 'node:crypto';
import { Router, json } from 'express';
import { parseRunConfig, type RunConfig, type FixedWindowDemoResponse } from '@ratelab/contracts';
import type { SharedWindowStore } from './redis.ts';
import { createFixedWindowLimiter } from './limiters/fixed-window.ts';
import { sendFixedWindowDecision } from './demo.ts';

type TargetEntry = {
  check: () => FixedWindowDemoResponse['decision'] | Promise<FixedWindowDemoResponse['decision']>;
  expiresAt: number;
};

export function createTargets(instanceId: string, secret?: string, now = Date.now, shared?: SharedWindowStore) {
  const entries = new Map<string, TargetEntry>();
  function prune() {
    for (const [token, entry] of entries) if (entry.expiresAt <= Date.now()) entries.delete(token);
  }
  async function register(token: string, config: RunConfig) {
    prune();
    if (entries.size >= 10 || entries.has(token)) throw new Error('TARGET_CAPACITY_REACHED');
    const entry: TargetEntry = { check: () => { throw new Error('REDIS_UNAVAILABLE'); },
      expiresAt: Date.now() + config.durationMs + 30_000 };
    entries.set(token, entry);
    if (config.stateMode === 'shared') {
      try {
        if (!shared) throw new Error('REDIS_UNAVAILABLE');
        entry.check = (await shared.register(token, config)).check;
      } catch { entries.delete(token); throw new Error('REDIS_UNAVAILABLE'); }
    } else {
      const limiter = createFixedWindowLimiter({ ...config, now });
      entry.check = () => limiter.check('global');
    }
  }
  const router = Router();
  router.use((_request, response, next) => { prune(); response.set('Cache-Control', 'no-store'); next(); });
  router.all('/target', async (request, response) => {
    if (request.method !== 'GET') { response.set('Allow', 'GET').status(405).end(); return; }
    const entry = entries.get(request.get('Authorization') ?? '');
    if (!entry || request.originalUrl.includes('?')) { response.status(404).end(); return; }
    try { sendFixedWindowDecision(response, await entry.check(), instanceId); }
    catch { response.set('X-RateLab-Error', 'REDIS_UNAVAILABLE').status(503).json({ error: 'REDIS_UNAVAILABLE' }); }
  });
  router.use((request, response, next) => {
    const credential = Buffer.from(request.get('Authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (!secret || credential.length !== expected.length || !timingSafeEqual(credential, expected)) {
      response.status(404).end(); return;
    }
    next();
  });
  router.post('/', json({ limit: '1kb' }), async (request, response) => {
    try {
      const { token, config } = request.body ?? {};
      if (typeof token !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(token)) throw new Error('INVALID_TOKEN');
      await register(token, parseRunConfig(config));
      response.status(201).json({ instanceId });
    } catch (error) {
      if (error instanceof Error && error.message === 'REDIS_UNAVAILABLE') {
        response.set('X-RateLab-Error', 'REDIS_UNAVAILABLE').status(503).json({ error: 'REDIS_UNAVAILABLE' });
      } else response.status(400).json({ error: 'TARGET_REGISTRATION_FAILED' });
    }
  });
  router.delete('/', json({ limit: '1kb' }), (request, response) => {
    if (typeof request.body?.token === 'string') entries.delete(request.body.token);
    response.status(204).end();
  });
  return { router, register, async cleanupShared(token: string) { await shared?.remove(token); }, remove: (token: string) => entries.delete(token) };
}
