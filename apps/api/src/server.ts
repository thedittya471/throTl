import { isIP } from 'node:net';
import express from 'express';

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

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_request, response) => {
    response.set('Cache-Control', 'no-store').json({ status: 'ok', service: 'ratelab-api' });
  });
  return app;
}
