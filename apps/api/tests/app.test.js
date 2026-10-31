import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";

async function start(t, checkDatabase) {
  const app = createApp({ checkDatabase, logger: { error() {} } });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

test("health stays live when the database fails; readiness fails safely", async (t) => {
  const origin = await start(t, async () => { throw new Error("private database credentials"); });
  const health = await fetch(`${origin}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-powered-by"), null);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  const ready = await fetch(`${origin}/ready`);
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: "unavailable", database: "unavailable" });
  assert.equal(ready.headers.get("cache-control"), "no-store");
});

test("readiness succeeds after a real dependency check and unknown routes return JSON", async (t) => {
  let checks = 0;
  const origin = await start(t, async () => { checks += 1; });
  const ready = await fetch(`${origin}/ready`);
  assert.equal(ready.status, 200);
  assert.equal(checks, 1);
  assert.deepEqual(await ready.json(), { status: "ok", database: "connected" });
  const missing = await fetch(`${origin}/missing`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "NOT_FOUND" });
});
