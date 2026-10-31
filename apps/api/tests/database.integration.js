import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/config.js";
import { createDatabase } from "../src/db/client.js";

test("Drizzle executes a query against PostgreSQL", async (t) => {
  const { pool, checkDatabase } = createDatabase(readConfig().databaseUrl);
  t.after(() => pool.end());
  const result = await checkDatabase();
  assert.equal(result.rows[0]["?column?"], 1);
});
