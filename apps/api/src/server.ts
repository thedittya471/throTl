import { CONTRACT_VERSION, type HealthResponse } from '@ratelab/contracts';
import { isIP } from 'node:net';
import express from 'express';
import type { SharedWindowStore } from './redis.ts';
import { createTargets } from './targets.ts';
import type { InstanceOptions } from './instances.ts';
import { createRunRouter } from './runs.ts';
import { createDemoRouter, type DemoOptions } from './demo.ts';

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const host = env.HOST ?? '127.0.0.1';
  const rawPort = env.PORT ?? '3001';
  const port = Number(rawPort);

  if (host !== 'localhost' && isIP(host) === 0) {
    throw new Error('HOST must be an IP address or localhost');
  }

  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return { host, port };
}

export function createApp(
  demoOptions: DemoOptions = {},
  instances: InstanceOptions = { instanceId: 'local', peers: [] },
  sharedStore?: SharedWindowStore,
) {
  const app = express();

  app.disable('x-powered-by');

  app.get('/health', (_request, response) => {
    response.set('Cache-Control', 'no-store');

    response.json({
      version: CONTRACT_VERSION,
      status: 'ok',
      service: 'ratelab-api',
    } satisfies HealthResponse);
  });

  const demoRouter = createDemoRouter({
    ...demoOptions,
    instanceId: instances.instanceId,
  });

  app.use('/demo', demoRouter);

  app.get('/instance', (_request, response) => {
    response.set('Cache-Control', 'no-store');

    return response.json({ instanceId: instances.instanceId });
  });

  const targets = createTargets(
    instances.instanceId,
    instances.secret,
    demoOptions.now,
    sharedStore,
  );

  app.use('/internal/runs', targets.router);

  const runs = createRunRouter(instances, targets);

  app.use('/runs', runs.router);

  app.locals.stopRuns = async () => {
    try {
      await runs.shutdown();
    } finally {
      // Close shared storage even if run cleanup fails.
      sharedStore?.close();
    }
  };

  return app;
}
