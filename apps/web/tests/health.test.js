import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/health/route.js";

test("health bridge reports a verified API and database connection", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.pathname, "/ready");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ status: "ok", database: "connected" });
  });
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("health bridge returns safe failures for unreachable, unhealthy, or invalid upstream responses", async (t) => {
  for (const upstream of [
    async () => { throw new Error("private upstream address"); },
    async () => Response.json({ error: "private database error" }, { status: 503 }),
    async () => new Response("invalid JSON"),
    async () => Response.json({ status: "ok", database: "unavailable" })
  ]) {
    const mock = t.mock.method(globalThis, "fetch", upstream);
    const response = await GET();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "unavailable" });
    mock.mock.restore();
  }
});
