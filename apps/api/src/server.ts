import { CONTRACT_VERSION, type HealthResponse } from '@ratelab/contracts';
import { isIP } from 'node:net';
import express from 'express';
import { createDemoRouter, type DemoOptions } from './demo.ts';

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const host = env.HOST ?? '127.0.0.1';
  const rawPort = env.PORT ?? '3001';
  const port = Number(rawPort);

  if (host !== 'localhost' && isIP(host) === 0) {
    throw new Error('HOST must be an IP address or localhost');
  }
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return { host, port };
}

export function createApp(demoOptions: DemoOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_request, response) => {
    response.set('Cache-Control', 'no-store').json({
      version: CONTRACT_VERSION, status: 'ok', service: 'ratelab-api',
    } satisfies HealthResponse);
  });
  app.use('/demo', createDemoRouter(demoOptions));
  return app;
}
