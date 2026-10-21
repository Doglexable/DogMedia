import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isAllowedMediaBrowserRequest } from "./media-request-boundary.js";

const COOKIE_NAME = "pfs_media_access";
const SESSION_SECONDS = 12 * 60 * 60;

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function constantTimeEqual(left, right) {
  return timingSafeEqual(digest(left), digest(right));
}

function readCookie(header) {
  const entry = String(header || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return entry?.slice(COOKIE_NAME.length + 1) || null;
}

function sessionKey(token) {
  return `media:access:${digest(token).toString("hex")}`;
}

export function createMediaAccess({ redis, secret, allowedOrigins = new Set() }) {
  if (typeof secret !== "string" || secret.length < 24) {
    throw new Error("PFS_MEDIA_ACCESS_KEY must contain at least 24 characters");
  }
  const secretDigest = digest(secret).toString("hex");

  async function authorized(request) {
    const authorization = request.headers.authorization;
    if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
      return constantTimeEqual(authorization.slice(7), secret);
    }
    const token = readCookie(request.headers.cookie);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
    return await redis.get(sessionKey(token)) === `${request.clientIp}:${secretDigest}`;
  }

  async function login(request, reply) {
    if (!isAllowedMediaBrowserRequest(request, allowedOrigins)) {
      return reply.code(403).send({ error: "Media login blocked by browser boundary" });
    }
    const origin = request.headers.origin;
    const sameOrigin = `${request.protocol}://${request.headers.host}`;
    if (origin && origin !== sameOrigin && !allowedOrigins.has(origin)) {
      return reply.code(403).send({ error: "Origin denied" });
    }
    const attemptKey = `media:access:attempts:${request.clientIp}`;
    if (Number(await redis.get(attemptKey)) >= 5) {
      return reply.code(429).send({ error: "Too many attempts; retry in a minute" });
    }
    const password = request.body?.password;
    if (typeof password !== "string" || !constantTimeEqual(password, secret)) {
      const attempts = await redis.incr(attemptKey);
      if (attempts === 1) await redis.expire(attemptKey, 60);
      return reply.code(401).send({ error: "Invalid access key" });
    }
    await redis.del(attemptKey);
    const token = randomBytes(32).toString("hex");
    await redis.set(sessionKey(token), `${request.clientIp}:${secretDigest}`, "EX", SESSION_SECONDS);
    const secure = request.protocol === "https" || process.env.NODE_ENV === "production" ? "; Secure" : "";
    reply.header("Set-Cookie", `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_SECONDS}${secure}`);
    reply.header("Cache-Control", "no-store");
    return { ok: true, expiresIn: SESSION_SECONDS };
  }

  async function logout(request, reply) {
    const token = readCookie(request.headers.cookie);
    if (token && /^[a-f0-9]{64}$/.test(token)) await redis.del(sessionKey(token));
    const secure = request.protocol === "https" || process.env.NODE_ENV === "production" ? "; Secure" : "";
    reply.header("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`);
    return { ok: true };
  }

  return { authorized, login, logout };
}

export function requirePrivateApiAccess(mediaAccess) {
  return async (request, reply) => {
    const path = request.url.split("?", 1)[0];
    if (path === "/api/check-access" || path === "/api/media-access/login"
      || path === "/api/media-access/logout" || path === "/api/media-access/status") return;
    if (!await mediaAccess.authorized(request)) {
      return reply.code(401).send({ error: "Media access key required", code: "MEDIA_ACCESS_REQUIRED" });
    }
  };
}
