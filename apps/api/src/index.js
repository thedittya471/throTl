import { createApp } from "./app.js";
import { readAuthConfig, readConfig } from "./config.js";
import { createDatabase } from "./db/client.js";

let config;
let authConfig;
try {
  config = readConfig();
  authConfig = readAuthConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { pool, db, checkDatabase } = createDatabase(config.databaseUrl);
const app = createApp({ checkDatabase, db, authConfig });
const server = app.listen(config.port, config.host, () => {
  console.log(`throTl API listening on http://${config.host}:${config.port}`);
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;

let isShuttingDown = false;

function shutdown(exitCode = 0) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  // Give active requests time to finish, but never wait forever.
  const shutdownTimeout = setTimeout(() => {
    process.exit(1);
  }, 10000);
  shutdownTimeout.unref();

  server.close(async () => {
    try {
      await pool.end();
      clearTimeout(shutdownTimeout);
      process.exitCode = exitCode;
    } catch {
      console.error("Database shutdown failed");
      process.exitCode = 1;
    }
  });
  server.closeIdleConnections();
}

server.on("error", (error) => {
  console.error(`HTTP server failed (${error.code ?? "UNKNOWN"})`);
  shutdown(1);
});
// SIGINT comes from Ctrl+C; hosting platforms usually send SIGTERM.
process.on("SIGINT", () => {
  shutdown();
});
process.on("SIGTERM", () => {
  shutdown();
});
