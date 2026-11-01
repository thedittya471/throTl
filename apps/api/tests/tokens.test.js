import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import jwt from "jsonwebtoken";
import { createTokens, hashToken, setAuthCookies, verifyToken } from "../src/auth/tokens.js";
import { readAuthConfig } from "../src/config.js";

const config = readAuthConfig({
  JWT_ACCESS_SECRET: "a".repeat(64),
  JWT_REFRESH_SECRET: "b".repeat(64),
  WEB_ORIGIN: "http://localhost:3100"
});

test("access and refresh JWTs have distinct purposes and bounded lifetimes", () => {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  const tokens = createTokens(userId, sessionId, expiresAt, config);
  const access = verifyToken(tokens.accessToken, "access", config);
  const refresh = verifyToken(tokens.refreshToken, "refresh", config);
  assert.equal(access.sub, userId);
  assert.equal(access.sid, sessionId);
  assert.equal(access.exp - access.iat, 900);
  assert.equal(refresh.exp, Math.floor(expiresAt.getTime() / 1000));
  assert.throws(() => verifyToken(tokens.accessToken, "refresh", config));
  assert.throws(() => verifyToken(tokens.refreshToken, "access", config));
  assert.notEqual(hashToken(tokens.refreshToken), tokens.refreshToken);
  assert.equal(hashToken(tokens.refreshToken).length, 64);
});

test("JWT verification rejects tampering, expiry, and missing claims", () => {
  assert.throws(() => verifyToken("not-a-token", "access", config));
  for (const claims of [{ exp: 1 }, { exp: Math.floor(Date.now() / 1000) + 60 }]) {
    const token = jwt.sign(claims, config.accessSecret, {
      algorithm: "HS256", issuer: "throtl", audience: "throtl-web"
    });
    assert.throws(() => verifyToken(token, "access", config));
  }
  const expired = jwt.sign({ sub: randomUUID(), sid: randomUUID(), type: "access", exp: 1 }, config.accessSecret, {
    algorithm: "HS256", issuer: "throtl", audience: "throtl-web"
  });
  assert.throws(() => verifyToken(expired, "access", config), { name: "TokenExpiredError" });
  const wrongAlgorithm = jwt.sign({ sub: randomUUID(), sid: randomUUID(), type: "access" }, config.accessSecret, {
    algorithm: "HS384", issuer: "throtl", audience: "throtl-web", expiresIn: 60
  });
  assert.throws(() => verifyToken(wrongAlgorithm, "access", config));
});

test("production cookies are HttpOnly, Secure, same-site, and expire with the session", () => {
  const cookies = [];
  const response = { cookie(name, value, options) { cookies.push({ name, value, options }); } };
  const expiresAt = new Date(Date.now() + 60000);
  const tokens = createTokens(randomUUID(), randomUUID(), expiresAt, config);
  setAuthCookies(response, tokens, expiresAt, { isProduction: true });
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) {
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.secure, true);
    assert.equal(cookie.options.sameSite, "lax");
    assert.equal(cookie.options.domain, undefined);
    assert.ok(cookie.options.maxAge > 0 && cookie.options.maxAge <= 60000);
  }
});

test("authentication requires separate strong secrets and HTTPS in production", () => {
  assert.throws(() => readAuthConfig({}), /JWT/);
  assert.throws(() => readAuthConfig({ JWT_ACCESS_SECRET: "a".repeat(64), JWT_REFRESH_SECRET: "a".repeat(64) }), /different/);
  assert.throws(() => readAuthConfig({ JWT_ACCESS_SECRET: "a".repeat(64), JWT_REFRESH_SECRET: "b".repeat(64), NODE_ENV: "production" }), /HTTPS/);
});
