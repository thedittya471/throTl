import { randomBytes } from 'node:crypto';
import { Router, json, type ErrorRequestHandler } from 'express';
import { parseRunConfig, type RunSnapshot } from '@ratelab/contracts';
import { createRunTelemetry } from './telemetry.ts';
import { createRunEvents } from './events.ts';
import type { InstanceOptions } from './instances.ts';
import type { createTargets } from './targets.ts';
import { createRunCounts, generateTraffic } from './traffic.ts';

type Run = {
  snapshot: RunSnapshot;
  controller: AbortController;
  done: Promise<void>;
  expiresAt: number;
  events: ReturnType<typeof createRunEvents>;
};

export function createRunRouter(instances: InstanceOptions,
  registry: ReturnType<typeof createTargets>) {
  const router = Router();
  const runs = new Map<string, Run>();

  let closing = false;

  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    for (const [token, run] of runs) {
      if (run.expiresAt <= Date.now()) { run.events.close(); runs.delete(token); }
    }
    next();
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

  router.get('/events', (request, response) => {
    const run = runs.get(request.get('Authorization') ?? '');
    if (!run) response.status(404).json({ error: 'RUN_NOT_FOUND' });
    else run.events.connect(response);
  });

  router.post('/', json({ limit: '1kb' }), async (request, response) => {
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
    const target = new URL(`http://${host}:${port}/internal/runs/target`);
    const token = randomBytes(32).toString('hex');
    const targetToken = `Bearer ${randomBytes(32).toString('hex')}`;
    const telemetry = createRunTelemetry();
    const routes = [{ url: target, id: instances.instanceId, counts: createRunCounts(config) }];
    routes[0]!.counts.scheduled = 0;
    // Reserve capacity before awaiting peer registration.
    const controller = new AbortController();
    const snapshot: RunSnapshot = {
      version: 1, id: randomBytes(16).toString('hex'), status: 'running',
      config, counts: createRunCounts(config), telemetry: telemetry.data,
      instances: routes.map(({ id, counts }) => ({ id, counts })),
    };
    const events = createRunEvents(snapshot, () => {
      snapshot.status = 'stopping';
      controller.abort();
    });
    let settle!: () => void;
    const done = new Promise<void>((resolve) => { settle = resolve; });
    const run: Run = {
      snapshot, controller, events, done,
      expiresAt: Infinity,
    };
    runs.set(`Bearer ${token}`, run);
    const peerRequest = (origin: string, method: string) => fetch(`${origin}/internal/runs`, {
      method, redirect: 'error', signal: AbortSignal.timeout(3_000),
      headers: { Authorization: `Bearer ${instances.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: targetToken, config }),
    });
    const cleanup = async () => {
      registry.remove(targetToken);
      const removed = await Promise.allSettled(instances.peers.map(async (origin) => { const result = await peerRequest(origin, 'DELETE'); await result.body?.cancel(); return result.ok; }));
      if (config.stateMode === 'shared' && removed.every((item) => item.status === 'fulfilled' && item.value)) {
        await registry.cleanupShared(targetToken).catch(() => {}); // TTL covers unavailable cleanup.
      }
    };
    try {
      await registry.register(targetToken, config);
      for (const origin of instances.peers) {
        const registered = await peerRequest(origin, 'POST');
        if (!registered.ok) {
          const redisUnavailable = registered.headers.get('X-RateLab-Error') === 'REDIS_UNAVAILABLE';
          await registered.body?.cancel();
          throw new Error(redisUnavailable ? 'REDIS_UNAVAILABLE' : 'TARGET_UNAVAILABLE');
        }
        const identity = await registered.json();
        if (typeof identity.instanceId !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(identity.instanceId) || routes.some((item) => item.id === identity.instanceId) || origin === target.origin) {
          throw new Error('INVALID_INSTANCE');
        }
        const peerCounts = createRunCounts(config); peerCounts.scheduled = 0;
        routes.push({ url: new URL(`${origin}/internal/runs/target`), id: identity.instanceId, counts: peerCounts });
      }
      snapshot.instances = routes.map(({ id, counts }) => ({ id, counts }));
      if (closing || controller.signal.aborted) throw new Error('RUN_STOPPED');
    } catch (error) {
      await cleanup(); events.close(); runs.delete(`Bearer ${token}`); settle();
      const code = error instanceof Error && error.message === 'REDIS_UNAVAILABLE' ? 'REDIS_UNAVAILABLE' : 'TARGET_UNAVAILABLE';
      if (code === 'REDIS_UNAVAILABLE') response.set('X-RateLab-Error', code);
      response.status(503).json({ error: code }); return;
    }
    void generateTraffic({ config, counts: snapshot.counts, target,
      token: targetToken.slice(7), signal: run.controller.signal, targets: routes,
      onDecision: (decision, instance) => telemetry.record(decision, instance),
      onUnavailable: () => {
        snapshot.error = 'REDIS_UNAVAILABLE'; snapshot.status = 'stopping'; controller.abort();
      },
      canDispatch: () => [...runs.values()].reduce((total, item) => total + item.snapshot.counts.inFlight, 0) < 2_048,
      onDraining() { if (snapshot.status === 'running') snapshot.status = 'draining'; },
    }).then(async () => {
      await cleanup();
      snapshot.status = snapshot.error ? 'failed' : run.controller.signal.aborted ? 'stopped' : 'completed';
      run.expiresAt = Date.now() + 10 * 60_000;
      events.finish();
    }).catch(async () => {
      console.error('Run stopped after an unexpected generator failure');
      await cleanup();
      snapshot.status = 'stopped';
      registry.remove(targetToken);
      run.expiresAt = Date.now() + 10 * 60_000;
      events.finish();
    }).finally(settle);
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
    for (const run of runs.values()) run.events.close();
  }
  return { router, shutdown };
}
