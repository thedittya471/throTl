import dotenv from "dotenv";

dotenv.config({ path: new URL("../../../.env", import.meta.url), quiet: true });

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

export function readAuthConfig(env = process.env) {
  const accessSecret = env.JWT_ACCESS_SECRET;
  const refreshSecret = env.JWT_REFRESH_SECRET;
  if (!accessSecret || !refreshSecret || accessSecret.length < 32 || refreshSecret.length < 32) {
    throw new Error("JWT secrets must each contain at least 32 characters; run npm run setup");
  }
  if (accessSecret === refreshSecret) {
    throw new Error("JWT access and refresh secrets must be different");
  }

  const isProduction = env.NODE_ENV === "production";
  const webUrl = new URL(env.WEB_ORIGIN ?? "http://localhost:3100");
  if (!["http:", "https:"].includes(webUrl.protocol) || webUrl.username || webUrl.password) {
    throw new Error("WEB_ORIGIN must be an HTTP or HTTPS origin");
  }
  if (isProduction && webUrl.protocol !== "https:") {
    throw new Error("WEB_ORIGIN must use HTTPS in production");
  }
  return { accessSecret, refreshSecret, webOrigin: webUrl.origin, isProduction };
}
