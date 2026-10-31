export function readConfig(env = process.env) {
  // Environment variables are strings, so validate before using them.
  const portText = env.PORT ?? "4000";
  const port = Number(portText);
  const containsOnlyDigits = /^\d+$/.test(portText);

  if (!containsOnlyDigits || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  let connectionUrl;
  try {
    connectionUrl = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  const isPostgres = connectionUrl.protocol === "postgres:" || connectionUrl.protocol === "postgresql:";
  if (!isPostgres || !connectionUrl.hostname) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }

  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    databaseUrl: env.DATABASE_URL
  };
}
