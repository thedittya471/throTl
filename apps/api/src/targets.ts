import { timingSafeEqual } from 'node:crypto';
import { Router, json } from 'express';
import { parseRunConfig, type RunConfig } from '@ratelab/contracts';
import { createFixedWindowLimiter } from './limiters/fixed-window.ts';
import { sendFixedWindowDecision } from './demo.ts';

export function createTargets(instanceId: string, secret?: string, now = Date.now) {
  const entries = new Map<string, { limiter: ReturnType<typeof createFixedWindowLimiter>; expiresAt: number }>();
  function prune() {
    for (const [token, entry] of entries) if (entry.expiresAt <= Date.now()) entries.delete(token);
  }
  function register(token: string, config: RunConfig) {
    prune();
    if (entries.size >= 10 || entries.has(token)) throw new Error('TARGET_CAPACITY_REACHED');
    entries.set(token, { limiter: createFixedWindowLimiter({ ...config, now }),
      expiresAt: Date.now() + config.durationMs + 30_000 });
  }
  const router = Router();
  router.use((_request, response, next) => { prune(); response.set('Cache-Control', 'no-store'); next(); });
  router.all('/target', (request, response) => {
    if (request.method !== 'GET') { response.set('Allow', 'GET').status(405).end(); return; }
    const entry = entries.get(request.get('Authorization') ?? '');
    if (!entry || request.originalUrl.includes('?')) { response.status(404).end(); return; }
    sendFixedWindowDecision(response, entry.limiter.check('global'), instanceId);
  });
  router.use((request, response, next) => {
    const credential = Buffer.from(request.get('Authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (!secret || credential.length !== expected.length || !timingSafeEqual(credential, expected)) {
      response.status(404).end(); return;
    }
    next();
  });
  router.post('/', json({ limit: '1kb' }), (request, response) => {
    try {
      const { token, config } = request.body ?? {};
      if (typeof token !== 'string' || !/^Bearer [a-f0-9]{64}$/.test(token)) throw new Error('INVALID_TOKEN');
      register(token, parseRunConfig(config));
      response.status(201).json({ instanceId });
    } catch { response.status(400).json({ error: 'TARGET_REGISTRATION_FAILED' }); }
  });
  router.delete('/', json({ limit: '1kb' }), (request, response) => {
    if (typeof request.body?.token === 'string') entries.delete(request.body.token);
    response.status(204).end();
  });
  return { router, register, remove: (token: string) => entries.delete(token) };
}
