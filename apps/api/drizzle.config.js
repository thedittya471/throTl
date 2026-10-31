import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "drizzle-kit";
import { readConfig } from "./src/config.js";

const envFile = new URL("../../.env", import.meta.url);
if (existsSync(envFile)) {
  loadEnvFile(envFile);
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.js",
  out: "./drizzle",
  dbCredentials: {
    url: readConfig().databaseUrl
  }
});
