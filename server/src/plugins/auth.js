import { createHash, randomBytes } from "node:crypto";
import { hashPassword, matchesPassword } from "../password.js";
import { isIP } from "node:net";
import { isAllowedMediaBrowserRequest } from "../media-request-boundary.js";

const COOKIE_NAME = "pfs_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const SESSION_RE = /^[a-f0-9]{64}$/;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,40}$/;

function normalizeIp(value) {
  const ip = String(value || "").trim().replace(/^\[([^\]]+)\]$/, "$1");
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function lastValidIp(value) {
  const headers = Array.isArray(value) ? value : [value];
  for (let i = headers.length - 1; i >= 0; i--) {
    if (typeof headers[i] !== "string") continue;
    const parts = headers[i].split(",");
    for (let j = parts.length - 1; j >= 0; j--) {
      const ip = normalizeIp(parts[j]);
      if (isIP(ip)) return ip;
    }
  }
  return null;
}

export function getClientIp(request) {
  const peer = request.raw?.socket?.remoteAddress || request.socket?.remoteAddress || request.ip;
  if (normalizeIp(peer) === "127.0.0.1" || normalizeIp(peer) === "::1") {
    return lastValidIp(request.headers?.["x-forwarded-for"])
      || lastValidIp(request.headers?.["x-real-ip"])
      || normalizeIp(request.ip || peer);
  }
  return normalizeIp(request.ip || peer);
}

function tokenKey(token) {
  return `auth:session:${createHash("sha256").update(token).digest("hex")}`;
}

export function formatSessionValue(userId, sessionVersion = 0) {
  return `${userId}:${sessionVersion ?? 0}`;
}

export function parseSessionValue(value) {
  if (typeof value !== "string" || !value) return null;
  if (/^\d+$/.test(value)) {
    return { userId: Number(value), sessionVersion: 0 };
  }
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  return { userId: Number(match[1]), sessionVersion: Number(match[2]) };
}

export async function isUserSessionValid(pg, userId, sessionVersion) {
  if (!pg?.query || !userId) return false;
  try {
    const { rows } = await pg.query("SELECT session_version FROM users WHERE id = $1", [userId]);
    if (!rows.length) return false;
    return Number(rows[0].session_version ?? 0) === Number(sessionVersion ?? 0);
  } catch {
    return false;
  }
}

function cookieToken(header) {
  const entry = String(header || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return entry?.slice(COOKIE_NAME.length + 1) || null;
}

function setCookie(reply, request, token, maxAge) {
  const secure = request.protocol === "https" ? "; Secure" : "";
  reply.header("Set-Cookie", `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${secure}`);
  reply.header("Cache-Control", "no-store");
}

function accountIp(id) {
  const value = Number(id);
  const high = Math.floor(value / 65536);
  const low = (value % 65536).toString(16);
  return high ? `fd50::${high.toString(16)}:${low}` : `fd50::${low}`;
}

function validCredentials(body) {
  return USERNAME_RE.test(body?.username || "")
    && typeof body?.password === "string"
    && body.password.length >= 12 && body.password.length <= 256;
}

export default async function authPlugin(fastify, { allowedOrigins = new Set() } = {}) {
  async function startSession(request, reply, user) {
    const token = randomBytes(32).toString("hex");
    const sessionVersion = Number(user.session_version ?? 0);
    await fastify.redis.set(tokenKey(token), formatSessionValue(user.id, sessionVersion), "EX", SESSION_SECONDS);
    setCookie(reply, request, token, SESSION_SECONDS);
    return { token, user: { id: user.id, username: user.username, tier: user.access_tier, profile_picture: user.profile_picture || "fine" } };
  }

  fastify.addHook("onRequest", async (request, reply) => {
    request.networkIp = getClientIp(request);
    request.clientIp = request.networkIp;
    const path = request.url.split("?", 1)[0];
    if (path === "/api/auth/register" || path === "/api/auth/login") return;

    const bearer = /^Bearer ([a-f0-9]{64})$/.exec(String(request.headers.authorization || ""));
    const token = bearer?.[1] || cookieToken(request.headers.cookie);
    if (!token || !SESSION_RE.test(token)) return reply.code(401).send({ error: "Login required", code: "LOGIN_REQUIRED" });
    if (!bearer && !isAllowedMediaBrowserRequest(request, allowedOrigins)) {
      return reply.code(403).send({ error: "Origin denied" });
    }
    const rawSession = await fastify.redis.get(tokenKey(token));
    if (!rawSession) return reply.code(401).send({ error: "Session expired", code: "LOGIN_REQUIRED" });
    const parsed = parseSessionValue(rawSession);
    if (!parsed) return reply.code(401).send({ error: "Session expired", code: "LOGIN_REQUIRED" });

    const { rows } = await fastify.pg.query("SELECT id, username, access_tier, profile_picture, session_version, eq_settings FROM users WHERE id = $1", [parsed.userId]);
    if (!rows.length) return reply.code(401).send({ error: "Account unavailable", code: "LOGIN_REQUIRED" });
    if (Number(rows[0].session_version ?? 0) !== parsed.sessionVersion) {
      return reply.code(401).send({ error: "Session expired", code: "LOGIN_REQUIRED" });
    }

    request.user = rows[0];
    request.authToken = token;
    request.accessTier = Number(rows[0].access_tier);
    request.accessDescription = rows[0].username;
    // Redis playback and queue keys still use a stable account-scoped identity.
    request.clientIp = accountIp(rows[0].id);
  });

  fastify.post("/auth/register", async (request, reply) => {
    if (!isAllowedMediaBrowserRequest(request, allowedOrigins)) return reply.code(403).send({ error: "Origin denied" });
    if (!validCredentials(request.body)) {
      return reply.code(400).send({ error: "Username must be 3–40 letters, numbers, dots, underscores or hyphens; password must be 12–256 characters" });
    }
    const signupKey = `auth:register:${request.networkIp}`;
    if (Number(await fastify.redis.get(signupKey)) >= 20) {
      return reply.code(429).send({ error: "Too many registrations; retry later" });
    }
    const signupAttempts = await fastify.redis.incr(signupKey);
    if (signupAttempts === 1) await fastify.redis.expire(signupKey, 3600);
    const username = request.body.username.trim();
    const hash = await hashPassword(request.body.password);
    let user;
    try {
      const { rows } = await fastify.pg.query(
        "INSERT INTO users (username, password_hash, access_tier, profile_picture, session_version) VALUES ($1, $2, 0, 'fine', 0) RETURNING id, username, access_tier, profile_picture, session_version",
        [username, hash]
      );
      user = rows[0];
    } catch (error) {
      if (error.code === "23505") return reply.code(409).send({ error: "Username already exists" });
      throw error;
    }
    return reply.code(201).send(await startSession(request, reply, user));
  });

  fastify.post("/auth/login", async (request, reply) => {
    if (!isAllowedMediaBrowserRequest(request, allowedOrigins)) return reply.code(403).send({ error: "Origin denied" });
    const key = `auth:attempts:${request.networkIp}`;
    if (Number(await fastify.redis.get(key)) >= 10) return reply.code(429).send({ error: "Too many attempts; retry later" });
    const { username, password } = request.body || {};
    if (typeof username !== "string" || typeof password !== "string") return reply.code(400).send({ error: "Username and password required" });
    const { rows } = await fastify.pg.query("SELECT id, username, password_hash, access_tier, profile_picture, session_version FROM users WHERE lower(username) = lower($1)", [username]);
    if (!rows.length || !await matchesPassword(password, rows[0].password_hash)) {
      const attempts = await fastify.redis.incr(key);
      if (attempts === 1) await fastify.redis.expire(key, 300);
      return reply.code(401).send({ error: "Invalid username or password" });
    }
    await fastify.redis.del(key);
    return startSession(request, reply, rows[0]);
  });

  fastify.get("/auth/profile", async (request) => {
    return {
      ok: true,
      user: {
        id: request.user.id,
        username: request.user.username,
        tier: request.accessTier,
        profile_picture: request.user.profile_picture || "fine",
        eq_settings: request.user.eq_settings || null,
      },
    };
  });

  fastify.put("/auth/profile", async (request, reply) => {
    const { username, password, currentPassword, profile_picture, eq_settings } = request.body || {};
    const { rows } = await fastify.pg.query(
      "SELECT id, username, password_hash, access_tier, profile_picture, session_version, eq_settings FROM users WHERE id = $1",
      [request.user.id]
    );
    if (!rows.length) return reply.code(404).send({ error: "Account not found" });
    const user = rows[0];

    const hasNewPassword = typeof password === "string" && password.length > 0;
    const hasNewUsername = typeof username === "string" && username.trim() !== user.username;
    const hasNewProfilePicture = typeof profile_picture === "string" && profile_picture.trim() !== (user.profile_picture || "fine");
    const hasNewEqSettings = eq_settings !== undefined && eq_settings !== null && typeof eq_settings === "object";

    if (!hasNewPassword && !hasNewUsername && !hasNewProfilePicture && !hasNewEqSettings) {
      return reply.code(400).send({ error: "No changes requested" });
    }

    if (hasNewPassword) {
      if (password.length < 12 || password.length > 256) {
        return reply.code(400).send({ error: "New password must be 12–256 characters" });
      }
      if (!currentPassword || !await matchesPassword(currentPassword, user.password_hash)) {
        return reply.code(400).send({ error: "Current password incorrect" });
      }
    } else if (currentPassword) {
      if (!await matchesPassword(currentPassword, user.password_hash)) {
        return reply.code(400).send({ error: "Current password incorrect" });
      }
    }

    let nextUsername = user.username;
    if (hasNewUsername) {
      nextUsername = username.trim();
      if (!USERNAME_RE.test(nextUsername)) {
        return reply.code(400).send({ error: "Username must be 3–40 letters, numbers, dots, underscores or hyphens" });
      }
    }

    let nextHash = user.password_hash;
    if (hasNewPassword) {
      nextHash = await hashPassword(password);
    }

    let nextProfilePicture = user.profile_picture || "fine";
    if (hasNewProfilePicture) {
      const cleanPic = profile_picture.trim().replace(/^_+|_+$/g, "").replace(/_(s|l|m|f)\.webp$/i, "");
      if (!/^[a-zA-Z0-9_-]{1,60}$/.test(cleanPic)) {
        return reply.code(400).send({ error: "Invalid profile picture format" });
      }
      nextProfilePicture = cleanPic;
    }

    let nextEqSettings = user.eq_settings || null;
    if (hasNewEqSettings) {
      const gains = Array.isArray(eq_settings.gains)
        ? eq_settings.gains.slice(0, 10).map((g) => Math.min(10, Math.max(-10, Number(g) || 0)))
        : (user.eq_settings?.gains || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      while (gains.length < 10) gains.push(0);

      nextEqSettings = {
        enabled: Boolean(eq_settings.enabled),
        preset: typeof eq_settings.preset === "string" ? eq_settings.preset.slice(0, 50) : "custom",
        gains,
        targetDb: Math.min(10, Math.max(-10, Number(eq_settings.targetDb) || 0)),
      };
    }

    try {
      const updateSql = hasNewPassword
        ? "UPDATE users SET username = $1, password_hash = $2, profile_picture = $3, eq_settings = $4, session_version = session_version + 1 WHERE id = $5 RETURNING id, username, access_tier, profile_picture, session_version, eq_settings"
        : "UPDATE users SET username = $1, password_hash = $2, profile_picture = $3, eq_settings = $4 WHERE id = $5 RETURNING id, username, access_tier, profile_picture, session_version, eq_settings";
      const { rows: updatedRows } = await fastify.pg.query(
        updateSql,
        [nextUsername, nextHash, nextProfilePicture, JSON.stringify(nextEqSettings), user.id]
      );
      const updated = updatedRows[0];

      if (hasNewPassword) {
        try {
          await fastify.redis.set(tokenKey(request.authToken), formatSessionValue(updated.id, updated.session_version), "KEEPTTL");
        } catch (error) {
          request.log?.error?.(error, "Failed to rebind session after password change");
          return reply.code(500).send({ error: "Failed to refresh session; please log in again" });
        }
      }

      return {
        ok: true,
        user: {
          id: updated.id,
          username: updated.username,
          tier: updated.access_tier,
          profile_picture: updated.profile_picture || "fine",
          eq_settings: updated.eq_settings || null,
        },
      };
    } catch (error) {
      if (error.code === "23505") {
        return reply.code(409).send({ error: "Username already exists" });
      }
      throw error;
    }
  });

  fastify.post("/auth/logout", async (request, reply) => {
    await fastify.redis.del(tokenKey(request.authToken));
    setCookie(reply, request, "", 0);
    return { ok: true };
  });
}
