import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/config.js";

const env = { DATABASE_URL: "postgresql://user:password@localhost/throtl" };

test("configuration has safe local defaults", () => {
  assert.deepEqual(readConfig(env), {
    host: "127.0.0.1", port: 4000, databaseUrl: env.DATABASE_URL
  });
});

test("configuration rejects invalid ports and database URLs without leaking secrets", () => {
  for (const port of ["", "0", "65536", "3.5", "1e3", "abc"]) {
    assert.throws(() => readConfig({ ...env, PORT: port }), /PORT/);
  }
  for (const databaseUrl of [undefined, "", "https://secret:password@example.com/db", "invalid-secret"]) {
    assert.throws(() => readConfig({ DATABASE_URL: databaseUrl }), /^Error: DATABASE_URL must be a PostgreSQL connection URL$/);
  }
});
