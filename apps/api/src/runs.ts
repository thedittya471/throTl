import { randomBytes } from 'node:crypto';
import { Router, json, type ErrorRequestHandler } from 'express';
import { parseRunConfig, type RunSnapshot } from '@ratelab/contracts';
import { sendFixedWindowDecision } from './demo.ts';
import { createFixedWindowLimiter } from './limiters/fixed-window.ts';
import { createRunCounts, generateTraffic } from './traffic.ts';

type Run = {
  snapshot: RunSnapshot;
  controller: AbortController;
  done: Promise<void>;
  limiter: ReturnType<typeof createFixedWindowLimiter>;
  expiresAt: number;
};

export function createRunRouter(now = Date.now) {
  const router = Router();
  const runs = new Map<string, Run>();
  const targets = new Map<string, Run>();
  let closing = false;

  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    for (const [token, run] of runs) {
      if (run.expiresAt <= Date.now()) runs.delete(token);
    }
    next();
  });

  // Target credentials are private to the generator, separate from browser control credentials.
  router.get('/target', (request, response) => {
    const run = targets.get(request.get('Authorization') ?? '');
    if (!run || !['running', 'draining'].includes(run.snapshot.status)) {
      response.status(404).json({ error: 'TARGET_NOT_FOUND' });
      return;
    }
    const decision = run.limiter.check('global');
    sendFixedWindowDecision(response, decision);
  });

  router.use((request, response, next) => {
    if (request.get('X-RateLab-Request') !== '1') {
      response.status(403).json({ error: 'CONTROL_HEADER_REQUIRED' });
      return;
    }
    if (request.originalUrl.includes('?')) {
      response.status(400).json({ error: 'QUERY_NOT_SUPPORTED' });
      return;
    }
    next();
  });

  router.post('/', json({ limit: '1kb' }), (request, response) => {
    let config;
    try { config = parseRunConfig(request.body); }
    catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : 'INVALID_CONFIG' });
      return;
    }
    const active = [...runs.values()].filter((run) => !Number.isFinite(run.expiresAt));
    if (closing || runs.size >= 20 || active.length >= 10 ||
        active.reduce((rate, run) => rate + run.snapshot.config.ratePerSecond, 0) + config.ratePerSecond > 5_000) {
      response.status(503).json({ error: 'RUN_CAPACITY_REACHED' });
      return;
    }
    const address = request.socket.localAddress;
    const port = request.socket.localPort;
    if (!address || !port) {
      response.status(503).json({ error: 'TARGET_UNAVAILABLE' });
      return;
    }
    const host = address.includes(':') ? `[${address}]` : address;
    const target = new URL(`http://${host}:${port}/runs/target`);
    const token = randomBytes(32).toString('hex');
    const targetToken = `Bearer ${randomBytes(32).toString('hex')}`;
    const snapshot: RunSnapshot = {
      version: 1, id: randomBytes(16).toString('hex'), status: 'running',
      config, counts: createRunCounts(config),
    };
    const run: Run = {
      snapshot, controller: new AbortController(), done: Promise.resolve(),
      limiter: createFixedWindowLimiter({ ...config, now }), expiresAt: Infinity,
    };
    runs.set(`Bearer ${token}`, run);
    targets.set(targetToken, run);
    run.done = generateTraffic({ config, counts: snapshot.counts, target,
      token: targetToken.slice(7), signal: run.controller.signal,
      canDispatch: () => [...runs.values()].reduce((total, item) => total + item.snapshot.counts.inFlight, 0) < 2_048,
      onDraining() { if (snapshot.status === 'running') snapshot.status = 'draining'; },
    }).then(() => {
      snapshot.status = run.controller.signal.aborted ? 'stopped' : 'completed';
      targets.delete(targetToken);
      run.expiresAt = Date.now() + 10 * 60_000;
    });
    response.status(201).json({ run: snapshot, token });
  });

  router.get('/', (request, response) => {
    const run = runs.get(request.get('Authorization') ?? '');
    if (!run) response.status(404).json({ error: 'RUN_NOT_FOUND' });
    else response.json(run.snapshot);
  });

  router.delete('/', async (request, response) => {
    const run = runs.get(request.get('Authorization') ?? '');
    if (!run) {
      response.status(404).json({ error: 'RUN_NOT_FOUND' });
      return;
    }
    if (!Number.isFinite(run.expiresAt)) {
      run.snapshot.status = 'stopping';
      run.controller.abort();
      await run.done;
    }
    response.json(run.snapshot);
  });

  const invalidJson: ErrorRequestHandler = (error, _request, response, next) => {
    if (response.headersSent) { next(error); return; }
    const status = error?.status === 413 ? 413 : error instanceof SyntaxError ? 400 : 500;
    response.status(status).json({ error: status === 500 ? 'RUN_FAILED' : 'INVALID_JSON_BODY' });
  };
  router.use(invalidJson);

  async function shutdown() {
    closing = true;
    for (const run of runs.values()) run.controller.abort();
    await Promise.all([...runs.values()].map((run) => run.done));
  }
  return { router, shutdown };
}
