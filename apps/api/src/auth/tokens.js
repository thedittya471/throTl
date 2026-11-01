import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

export const ACCESS_SECONDS = 15 * 60;
export const SESSION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function createTokens(userId, sessionId, expiresAt, config) {
  const remainingSeconds = Math.floor(expiresAt.getTime() / 1000) - Math.floor(Date.now() / 1000);
  const options = { algorithm: "HS256", issuer: "throtl", audience: "throtl-web" };
  const claims = { sub: userId, sid: sessionId };

  const accessToken = jwt.sign({ ...claims, type: "access" }, config.accessSecret, {
    ...options,
    expiresIn: Math.min(ACCESS_SECONDS, remainingSeconds)
  });
  const refreshToken = jwt.sign({
    ...claims,
    type: "refresh",
    jti: randomUUID(),
    exp: Math.floor(expiresAt.getTime() / 1000)
  }, config.refreshSecret, options);

  return { accessToken, refreshToken };
}

export function verifyToken(token, type, config) {
  if (typeof token !== "string" || token.length > 2048) {
    throw new Error("Invalid token");
  }
  const secret = type === "access" ? config.accessSecret : config.refreshSecret;
  const claims = jwt.verify(token, secret, {
    algorithms: ["HS256"], issuer: "throtl", audience: "throtl-web"
  });
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (claims.type !== type || !uuidPattern.test(claims.sub) || !uuidPattern.test(claims.sid) || !Number.isInteger(claims.exp)) {
    throw new Error("Invalid token claims");
  }
  return claims;
}

export function setAuthCookies(response, tokens, expiresAt, config) {
  const options = { httpOnly: true, secure: config.isProduction, sameSite: "lax", path: "/" };
  const remainingMilliseconds = Math.max(0, expiresAt.getTime() - Date.now());
  response.cookie("throtl_access", tokens.accessToken, {
    ...options, maxAge: Math.min(ACCESS_SECONDS * 1000, remainingMilliseconds)
  });
  response.cookie("throtl_refresh", tokens.refreshToken, {
    ...options, maxAge: remainingMilliseconds
  });
}

export function clearAuthCookies(response, config) {
  const options = { httpOnly: true, secure: config.isProduction, sameSite: "lax", path: "/" };
  response.clearCookie("throtl_access", options);
  response.clearCookie("throtl_refresh", options);
}
