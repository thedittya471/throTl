import { defineConfig } from "drizzle-kit";
import { readConfig } from "./src/config.js";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.js",
  out: "./drizzle",
  dbCredentials: {
    url: readConfig().databaseUrl
  }
});
