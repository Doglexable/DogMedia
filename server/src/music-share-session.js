import { randomBytes } from "crypto";

const SESSION_PREFIX = "public-music-reel:session:";
const RATE_PREFIX = "public-music-reel:exchange-rate:";
const SESSION_SECONDS = 14_400;

function validOpaqueId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,60}$/.test(value);
}

export function publicMusicSessionKey(sessionId) {
  return `${SESSION_PREFIX}${sessionId}`;
}

export async function createPublicMusicSession(redis, details) {
  const sessionId = randomBytes(32).toString("base64url");
  const now = Date.now();
  const session = { shareId: Number(details.shareId), createdAt: now, expiresAt: now + SESSION_SECONDS * 1_000 };
  await redis.set(publicMusicSessionKey(sessionId), JSON.stringify(session), "EX", SESSION_SECONDS);
  return { sessionId, session, ttlSeconds: SESSION_SECONDS };
}

export async function readPublicMusicSession(redis, sessionId) {
  if (!validOpaqueId(sessionId)) return null;
  const raw = await redis.get(publicMusicSessionKey(sessionId));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    return Number(session.expiresAt) > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export async function checkPublicMusicExchangeRate(redis, clientIp, { limit = 12, windowSeconds = 60 } = {}) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1_000));
  const key = `${RATE_PREFIX}${String(clientIp)}:${bucket}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds + 1);
    return count <= limit;
  } catch {
    return true;
  }
}
