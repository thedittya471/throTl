import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { Router, json } from "express";
import { authAttempts, sessions, users } from "../db/schema.js";
import { clearAuthCookies, createTokens, hashToken, SESSION_MILLISECONDS, setAuthCookies, verifyToken } from "./tokens.js";

// Comparing against a dummy hash keeps missing-account and wrong-password work similar.
const dummyPasswordHash = await bcrypt.hash("not-a-real-user-password", 12);

function readCredentials(body) {
  if (!body || typeof body.email !== "string" || typeof body.password !== "string") return null;
  if (Object.keys(body).some((key) => key !== "email" && key !== "password")) return null;
  const email = body.email.trim().toLowerCase();
  const password = body.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (Array.from(password).length < 12 || Buffer.byteLength(password, "utf8") > 72) return null;
  return { email, password };
}

async function allowAttempt(db, name, limit, windowMilliseconds) {
  const window = Math.floor(Date.now() / windowMilliseconds);
  const [attempt] = await db.insert(authAttempts).values({
    key: `${name}:${window}`,
    count: 1,
    expiresAt: new Date((window + 1) * windowMilliseconds)
  }).onConflictDoUpdate({
    target: authAttempts.key,
    set: { count: sql`${authAttempts.count} + 1` }
  }).returning({ count: authAttempts.count });
  return attempt.count <= limit;
}

async function startSession(db, userId, config) {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MILLISECONDS);
  const tokens = createTokens(userId, sessionId, expiresAt, config);
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    refreshHash: hashToken(tokens.refreshToken),
    expiresAt
  });
  return { tokens, expiresAt };
}

export function requireUser(db, config) {
  return async function authenticate(request, response, next) {
    let claims;
    try {
      claims = verifyToken(request.cookies.throtl_access, "access", config);
    } catch {
      return response.status(401).json({ error: "Please log in" });
    }

    // Checking the session makes logout take effect immediately, even for an unexpired JWT.
    const [user] = await db.select({ id: users.id, email: users.email })
      .from(users).innerJoin(sessions, eq(sessions.userId, users.id))
      .where(and(eq(users.id, claims.sub), eq(sessions.id, claims.sid), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!user) return response.status(401).json({ error: "Please log in" });
    request.user = user;
    next();
  };
}

export function createAuthRouter(db, config) {
  const router = Router();
  router.use(cookieParser());
  router.use((request, response, next) => {
    // SameSite cookies help, but an exact Origin check also protects against sibling sites.
    if (request.method !== "GET" && request.get("origin") !== config.webOrigin) {
      return response.status(403).json({ error: "Untrusted request origin" });
    }
    next();
  });
  router.use(json({ limit: "2kb" }));

  router.post(["/register", "/login"], async (request, response, next) => {
    await db.delete(authAttempts).where(lt(authAttempts.expiresAt, new Date()));
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    if (!await allowAttempt(db, "global", 100, 60000)) {
      return response.set("Retry-After", "60").status(429).json({ error: "Too many attempts. Try again later." });
    }
    const credentials = readCredentials(request.body);
    if (!credentials) {
      return response.status(400).json({ error: "Use a valid email and a password with at least 12 characters and at most 72 UTF-8 bytes." });
    }
    if (!await allowAttempt(db, hashToken(credentials.email), 10, 15 * 60000)) {
      return response.set("Retry-After", "900").status(429).json({ error: "Too many attempts. Try again later." });
    }
    request.credentials = credentials;
    next();
  });

  router.post("/register", async (request, response) => {
    const { email, password } = request.credentials;
    const passwordHash = await bcrypt.hash(password, 12);
    const account = await db.transaction(async (transaction) => {
      const [user] = await transaction.insert(users).values({ id: randomUUID(), email, passwordHash })
        .onConflictDoNothing({ target: users.email }).returning({ id: users.id, email: users.email });
      if (!user) return null;
      const session = await startSession(transaction, user.id, config);
      return { user, session };
    });
    if (!account) return response.status(409).json({ error: "Unable to create an account with this email" });
    setAuthCookies(response, account.session.tokens, account.session.expiresAt, config);
    response.status(201).json({ user: account.user });
  });

  router.post("/login", async (request, response) => {
    const { email, password } = request.credentials;
    const [account] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const passwordMatches = await bcrypt.compare(password, account?.passwordHash ?? dummyPasswordHash);
    if (!account || !passwordMatches) {
      return response.status(401).json({ error: "Invalid email or password" });
    }
    const session = await startSession(db, account.id, config);
    setAuthCookies(response, session.tokens, session.expiresAt, config);
    response.json({ user: { id: account.id, email: account.email } });
  });

  router.get("/me", requireUser(db, config), (request, response) => {
    response.json({ user: request.user });
  });

  router.post("/refresh", async (request, response) => {
    const oldToken = request.cookies.throtl_refresh;
    let claims;
    try {
      claims = verifyToken(oldToken, "refresh", config);
    } catch {
      return response.status(401).json({ error: "Please log in again" });
    }
    const validSession = and(
      eq(sessions.id, claims.sid), eq(sessions.userId, claims.sub),
      eq(sessions.refreshHash, hashToken(oldToken)), gt(sessions.expiresAt, new Date())
    );
    const [session] = await db.select().from(sessions).where(validSession).limit(1);
    if (!session) return response.status(401).json({ error: "Please log in again" });
    const tokens = createTokens(claims.sub, claims.sid, session.expiresAt, config);

    // Compare-and-update is atomic: two requests cannot rotate the same token successfully.
    const [rotated] = await db.update(sessions).set({ refreshHash: hashToken(tokens.refreshToken) })
      .where(validSession).returning({ id: sessions.id });
    if (!rotated) return response.status(401).json({ error: "Please log in again" });
    setAuthCookies(response, tokens, session.expiresAt, config);
    response.json({ status: "ok" });
  });

  router.post("/logout", async (request, response) => {
    let claims;
    try {
      claims = verifyToken(request.cookies.throtl_refresh, "refresh", config);
    } catch {
      // Logout can still revoke the session if only the access cookie remains.
      try {
        claims = verifyToken(request.cookies.throtl_access, "access", config);
      } catch {
        clearAuthCookies(response, config);
        return response.sendStatus(204);
      }
    }
    await db.delete(sessions).where(and(
      eq(sessions.id, claims.sid), eq(sessions.userId, claims.sub)
    ));
    clearAuthCookies(response, config);
    response.sendStatus(204);
  });

  return router;
}
