import { createServer } from 'node:http';
import { createApp, readConfig } from './server.ts';

try {
  const { host, port } = readConfig();
  const server = createServer(createApp());
  server.once('error', (error: NodeJS.ErrnoException) => {
    console.error(`API failed to listen: ${error.code ?? 'UNKNOWN'}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.info(`RateLab API listening on ${host}:${port}`);
  });

  const shutdown = () => {
    console.info('Stopping RateLab API');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'API startup failed');
  process.exitCode = 1;
}
