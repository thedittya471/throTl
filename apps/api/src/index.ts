import { readRedisUrl, createSharedWindowStore, type SharedWindowStore } from './redis.ts';
import { readInstances } from './instances.ts';
import { createServer } from 'node:http';
import { createApp, readConfig } from './server.ts';

try {
  const { host, port } = readConfig();
  const redisUrl = readRedisUrl();
  const instances = readInstances();

  let sharedStore: SharedWindowStore | undefined;

  if (redisUrl) {
    sharedStore = createSharedWindowStore(redisUrl);
  }

  const app = createApp({}, instances, sharedStore);
  const server = createServer(app);

  server.once('error', (error: NodeJS.ErrnoException) => {
    console.error(`API failed to listen: ${error.code ?? 'UNKNOWN'}`);

    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    console.info(`RateLab API listening on ${host}:${port}`);
  });

  const shutdown = async () => {
    console.info('Stopping RateLab API');

    // Force an exit if cleanup takes longer than ten seconds.
    const shutdownTimeout = setTimeout(() => {
      process.exit(1);
    }, 10_000);

    // This timer should not keep the process alive after cleanup finishes.
    shutdownTimeout.unref();

    await app.locals.stopRuns();

    server.close(() => {
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error('API startup failed');
  }

  process.exitCode = 1;
}
