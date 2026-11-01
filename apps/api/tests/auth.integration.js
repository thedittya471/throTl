import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import pg from "pg";
import test from "node:test";
import { createApp } from "../src/app.js";
import { readAuthConfig, readConfig } from "../src/config.js";
import { authAttempts, sessions, users } from "../src/db/schema.js";
import { hashToken, verifyToken } from "../src/auth/tokens.js";

const password = "a-test-password-123";
const config = readAuthConfig({
  JWT_ACCESS_SECRET: "a".repeat(64), JWT_REFRESH_SECRET: "b".repeat(64),
  WEB_ORIGIN: "http://localhost:3100"
});

function getCookies(response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

test("email/password authentication against isolated PostgreSQL tables", async (t) => {
  const databaseName = `throtl_auth_test_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new pg.Pool({ connectionString: readConfig().databaseUrl });
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  const databaseUrl = new URL(readConfig().databaseUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const pool = new pg.Pool({ connectionString: databaseUrl.toString() });
  const db = drizzle(pool);
  // This test creates and owns its disposable database; application data is never dropped.
  t.after(async () => {
    await pool.end();
    await adminPool.query(`DROP DATABASE "${databaseName}"`);
    await adminPool.end();
  });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  const app = createApp({ db, authConfig: config, checkDatabase: async () => {}, logger: { error() {} } });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;

  function request(action, { body, cookie = "", webOrigin = config.webOrigin } = {}) {
    return fetch(`${origin}/auth/${action}`, {
      method: action === "me" ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Origin: webOrigin, Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  let registeredCookies;
  let registeredUser;

  await t.test("registration normalizes email, hashes passwords, and sets safe cookies", async () => {
    const response = await request("register", { body: { email: " Learner@Example.com ", password } });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.deepEqual(Object.keys(result.user).sort(), ["email", "id"]);
    assert.equal(result.user.email, "learner@example.com");
    registeredUser = result.user;
    registeredCookies = getCookies(response);
    for (const cookie of response.headers.getSetCookie()) {
      assert.ok(cookie.includes("HttpOnly"));
      assert.ok(cookie.includes("SameSite=Lax"));
      assert.ok(cookie.includes("Path=/"));
    }
    const [account] = await db.select().from(users).where(eq(users.id, registeredUser.id));
    assert.equal(bcrypt.getRounds(account.passwordHash), 12);
    assert.ok(await bcrypt.compare(password, account.passwordHash));
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, registeredUser.id));
    const refresh = registeredCookies.split("throtl_refresh=")[1].split(";")[0];
    assert.equal(session.refreshHash, hashToken(refresh));
    const me = await request("me", { cookie: registeredCookies });
    assert.equal(me.status, 200);
  });

  await t.test("duplicate normalized emails cannot create another account", async () => {
    const response = await request("register", { body: { email: "LEARNER@example.com", password } });
    assert.equal(response.status, 409);
    const concurrent = await Promise.all([1, 2].map(() => request("register", {
      body: { email: "concurrent@example.com", password }
    })));
    assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]);
  });

  await t.test("login succeeds and wrong passwords do not reveal account existence", async () => {
    const response = await request("login", { body: { email: registeredUser.email, password } });
    assert.equal(response.status, 200);
    const wrong = await request("login", { body: { email: registeredUser.email, password: "wrong-password-123" } });
    const missing = await request("login", { body: { email: "missing@example.com", password } });
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.deepEqual(await wrong.json(), await missing.json());
  });

  await t.test("cross-site requests, malformed JSON, short/oversized passwords, and invalid cookies fail safely", async () => {
    const blocked = await request("logout", { webOrigin: "https://attacker.example" });
    assert.equal(blocked.status, 403);
    const missingOrigin = await request("logout", { webOrigin: "" });
    assert.equal(missingOrigin.status, 403);
    const me = await request("me", { cookie: "throtl_access=forged" });
    assert.equal(me.status, 401);
    for (const invalidPassword of ["short", "a".repeat(73), "🔒".repeat(6), "🔒".repeat(20)]) {
      const response = await request("register", { body: { email: "invalid@example.com", password: invalidPassword } });
      assert.equal(response.status, 400);
    }
    const invalid = await fetch(`${origin}/auth/login`, {
      method: "POST", headers: { Origin: config.webOrigin, "Content-Type": "application/json" }, body: "{"
    });
    assert.equal(invalid.status, 400);
    const oversized = await request("login", { body: { email: "a".repeat(3000), password } });
    assert.equal(oversized.status, 413);
  });

  await t.test("refresh rotation is single-use, including concurrent requests", async () => {
    const responses = await Promise.all([
      request("refresh", { cookie: registeredCookies }), request("refresh", { cookie: registeredCookies })
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
    const success = responses.find((response) => response.status === 200);
    const failure = responses.find((response) => response.status === 401);
    assert.equal(failure.headers.getSetCookie().length, 0);
    const replay = await request("refresh", { cookie: registeredCookies });
    assert.equal(replay.status, 401);
    const currentCookies = getCookies(success);
    const current = await request("me", { cookie: currentCookies });
    assert.equal(current.status, 200);
    // A logout racing with a refresh must still revoke the same session.
    const logout = await request("logout", { cookie: registeredCookies });
    assert.equal(logout.status, 204);
    assert.equal(logout.headers.getSetCookie().length, 2);
    const revokedAccess = await request("me", { cookie: registeredCookies });
    assert.equal(revokedAccess.status, 401);
    const revokedRefresh = await request("refresh", { cookie: currentCookies });
    assert.equal(revokedRefresh.status, 401);
    const repeatLogout = await request("logout", { cookie: currentCookies });
    assert.equal(repeatLogout.status, 204);
  });

  await t.test("expired database sessions cannot use access or refresh cookies", async () => {
    const login = await request("login", { body: { email: registeredUser.email, password } });
    assert.equal(login.status, 200);
    const cookie = getCookies(login);
    const accessToken = cookie.split("throtl_access=")[1].split(";")[0];
    const claims = verifyToken(accessToken, "access", config);
    await db.update(sessions).set({ expiresAt: new Date(0) }).where(eq(sessions.id, claims.sid));
    assert.equal((await request("me", { cookie })).status, 401);
    assert.equal((await request("refresh", { cookie })).status, 401);
  });

  await t.test("logout still revokes access when the refresh cookie is missing", async () => {
    const login = await request("login", { body: { email: "concurrent@example.com", password } });
    assert.equal(login.status, 200);
    const cookie = getCookies(login);
    const accessCookie = cookie.split("; ").find((part) => part.startsWith("throtl_access="));
    assert.equal((await request("logout", { cookie: accessCookie })).status, 204);
    assert.equal((await request("me", { cookie })).status, 401);
  });

  await t.test("email attempt limits are shared across independent API servers", async (t) => {
    const secondApp = createApp({ db, authConfig: config, checkDatabase: async () => {}, logger: { error() {} } });
    const secondServer = secondApp.listen(0, "127.0.0.1");
    t.after(() => new Promise((resolve) => {
      secondServer.close(resolve);
      secondServer.closeAllConnections();
    }));
    await once(secondServer, "listening");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request("login", { body: { email: "limited@example.com", password } });
      assert.equal(response.status, 401);
    }
    const limited = await fetch(`http://127.0.0.1:${secondServer.address().port}/auth/login`, {
      method: "POST", headers: { Origin: config.webOrigin, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "limited@example.com", password })
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "900");
  });

  await t.test("the global auth budget also blocks attempts using different emails", async (t) => {
    const now = Date.now();
    t.mock.method(Date, "now", () => now);
    const window = Math.floor(now / 60000);
    await db.insert(authAttempts).values({
      key: `global:${window}`, count: 100, expiresAt: new Date((window + 1) * 60000)
    }).onConflictDoUpdate({ target: authAttempts.key, set: { count: 100 } });
    const response = await request("login", { body: { email: "another@example.com", password } });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
  });
});
