import { randomBytes, timingSafeEqual } from "crypto";

export const PLAYBACK_SESSION_HEADER = "x-playback-session";
export const VIEWER_ID_HEADER = "x-viewer-id";
export const EXCLUSIVE_PLAYBACK_ENABLED = process.env.EXCLUSIVE_PLAYBACK_ENABLED !== "false";
export const EXCLUSIVE_PLAYBACK_TIER_CUTOFF = Math.max(
  0,
  Number.parseInt(process.env.EXCLUSIVE_PLAYBACK_TIER_CUTOFF || "100", 10) || 100
);
export const EXCLUSIVE_PLAYBACK_LEASE_SECONDS = Math.max(
  15,
  Number.parseInt(process.env.EXCLUSIVE_PLAYBACK_LEASE_SECONDS || "30", 10) || 30
);
export const PLAYBACK_SESSION_TTL_SECONDS = Math.max(
  300,
  Number.parseInt(process.env.PLAYBACK_SESSION_TTL_SECONDS || "21600", 10) || 21600
);
const VIEWER_COOKIE_NAME = "pfs_viewer";
const EXCLUSIVE_LEASE_KEY = "stream:exclusive:standard";

const ACQUIRE_LEASE_SCRIPT = `
local currentRaw = redis.call('GET', KEYS[1])
local previousSessionId = ''
if currentRaw then
  local current = cjson.decode(currentRaw)
  if current.viewerId ~= ARGV[1] then
    return {0, redis.call('PTTL', KEYS[1])}
  end
  previousSessionId = current.sessionId or ''
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return {1, tonumber(ARGV[3]), previousSessionId}
`;

const REFRESH_LEASE_SCRIPT = `
local currentRaw = redis.call('GET', KEYS[1])
if not currentRaw then return {0, -2} end
local current = cjson.decode(currentRaw)
if current.viewerId ~= ARGV[1] or current.sessionId ~= ARGV[2] then
  return {0, redis.call('PTTL', KEYS[1])}
end
current.lastHeartbeatAt = tonumber(ARGV[3])
redis.call('SET', KEYS[1], cjson.encode(current), 'PX', ARGV[4])
return {1, tonumber(ARGV[4])}
`;

const RELEASE_LEASE_SCRIPT = `
local currentRaw = redis.call('GET', KEYS[1])
if not currentRaw then return 0 end
local current = cjson.decode(currentRaw)
if current.viewerId ~= ARGV[1] then return 0 end
if ARGV[2] ~= '' and current.sessionId ~= ARGV[2] then return 0 end
return redis.call('DEL', KEYS[1])
`;

export function playbackSessionKey(sessionId) {
  return `stream:session:${sessionId}`;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function playbackCookieName(mediaId) {
  return `pfs_stream_${Number(mediaId)}`;
}

function validOpaqueId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value);
}

export function readViewerId(request) {
  const header = request.headers[VIEWER_ID_HEADER];
  if (validOpaqueId(header)) return header;
  const cookie = parseCookies(request.headers.cookie)[VIEWER_COOKIE_NAME];
  return validOpaqueId(cookie) ? cookie : null;
}

export function resolveViewerId(request) {
  return readViewerId(request) || randomBytes(24).toString("base64url");
}

export function setViewerCookie(request, reply, viewerId) {
  const secure = request.protocol === "https" || request.headers["x-forwarded-proto"] === "https";
  const parts = [
    `${VIEWER_COOKIE_NAME}=${encodeURIComponent(viewerId)}`,
    "Max-Age=31536000",
    "Path=/api",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) parts.push("Secure");
  reply.header("Set-Cookie", parts.join("; "));
}

export function parseCookies(value) {
  const cookies = {};
  for (const part of String(value || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

export function readPlaybackSessionId(request, mediaId) {
  const header = request.headers[PLAYBACK_SESSION_HEADER];
  if (typeof header === "string" && header.length <= 256) return header;
  const cookie = parseCookies(request.headers.cookie)[playbackCookieName(mediaId)];
  return typeof cookie === "string" && cookie.length <= 256 ? cookie : null;
}

export function setPlaybackSessionCookie(request, reply, mediaId, sessionId, maxAge) {
  const secure = request.protocol === "https" || request.headers["x-forwarded-proto"] === "https";
  const parts = [
    `${playbackCookieName(mediaId)}=${encodeURIComponent(sessionId)}`,
    `Max-Age=${maxAge}`,
    `Path=/api/media/${Number(mediaId)}/stream`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (secure) parts.push("Secure");
  reply.header("Set-Cookie", parts.join("; "));
}

export async function createPlaybackSession(redis, details) {
  const sessionId = randomBytes(32).toString("base64url");
  const now = Date.now();
  const ttlSeconds = Math.min(
    PLAYBACK_SESSION_TTL_SECONDS,
    Math.max(1800, (Number(details.duration) || 0) + 3600)
  );
  const session = {
    mediaId: Number(details.mediaId),
    clientIp: String(details.clientIp),
    accessTier: Number(details.accessTier),
    viewerId: details.viewerId,
    leaseRequired: Boolean(details.leaseRequired),
    quality: details.quality,
    sourceVersion: Number(details.sourceVersion || 1),
    createdAt: now,
    expiresAt: now + ttlSeconds * 1000,
  };
  await redis.set(playbackSessionKey(sessionId), JSON.stringify(session), "EX", ttlSeconds);
  return { sessionId, session, ttlSeconds };
}

export async function readPlaybackSession(redis, sessionId) {
  if (!validOpaqueId(sessionId)) return null;
  const raw = await redis.get(playbackSessionKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function revokePlaybackSession(redis, sessionId) {
  if (!validOpaqueId(sessionId)) return 0;
  return redis.del(playbackSessionKey(sessionId));
}

export async function validatePlaybackSession(redis, sessionId, expected) {
  if (!sessionId) return { valid: false, reason: "missing" };
  const session = await readPlaybackSession(redis, sessionId);
  if (!session) return { valid: false, reason: "expired" };

  const valid = Number(session.mediaId) === Number(expected.mediaId)
    && Number(session.sourceVersion) === Number(expected.sourceVersion || 1)
    && session.quality === expected.quality
    && safeEqual(session.clientIp, expected.clientIp)
    && Number(session.accessTier) === Number(expected.accessTier)
    && (!session.viewerId || safeEqual(session.viewerId, expected.viewerId))
    && Number(session.expiresAt) > Date.now();

  return valid ? { valid: true, session } : { valid: false, reason: "mismatch" };
}

export function requiresExclusiveLease(accessTier, mimeType) {
  return EXCLUSIVE_PLAYBACK_ENABLED
    && Number(accessTier) < EXCLUSIVE_PLAYBACK_TIER_CUTOFF
    && (mimeType?.startsWith("audio/") || mimeType?.startsWith("video/"));
}

export async function acquireExclusiveLease(redis, details) {
  const now = Date.now();
  const lease = {
    viewerId: details.viewerId,
    sessionId: details.sessionId,
    mediaId: Number(details.mediaId),
    clientIp: String(details.clientIp),
    platform: details.platform || "web",
    acquiredAt: now,
    lastHeartbeatAt: now,
  };
  const ttlMs = EXCLUSIVE_PLAYBACK_LEASE_SECONDS * 1000;
  const result = await redis.eval(
    ACQUIRE_LEASE_SCRIPT,
    1,
    EXCLUSIVE_LEASE_KEY,
    details.viewerId,
    JSON.stringify(lease),
    ttlMs
  );
  return {
    acquired: Number(result?.[0]) === 1,
    retryAfter: Math.max(1, Math.ceil(Math.max(0, Number(result?.[1]) || 0) / 1000)),
    previousSessionId: result?.[2] || null,
    lease,
  };
}

export async function refreshExclusiveLease(redis, viewerId, sessionId) {
  const ttlMs = EXCLUSIVE_PLAYBACK_LEASE_SECONDS * 1000;
  const result = await redis.eval(
    REFRESH_LEASE_SCRIPT,
    1,
    EXCLUSIVE_LEASE_KEY,
    viewerId,
    sessionId,
    Date.now(),
    ttlMs
  );
  return {
    refreshed: Number(result?.[0]) === 1,
    retryAfter: Math.max(1, Math.ceil(Math.max(0, Number(result?.[1]) || 0) / 1000)),
  };
}

export async function releaseExclusiveLease(redis, viewerId, sessionId = "") {
  return Number(await redis.eval(
    RELEASE_LEASE_SCRIPT,
    1,
    EXCLUSIVE_LEASE_KEY,
    viewerId,
    sessionId || ""
  )) === 1;
}

export async function getExclusiveLease(redis) {
  const raw = await redis.get(EXCLUSIVE_LEASE_KEY);
  if (!raw) return null;
  try {
    const lease = JSON.parse(raw);
    const ttlMs = await redis.pttl(EXCLUSIVE_LEASE_KEY);
    return { ...lease, expiresIn: Math.max(0, Math.ceil(ttlMs / 1000)) };
  } catch {
    return null;
  }
}

export async function forceReleaseExclusiveLease(redis) {
  return redis.del(EXCLUSIVE_LEASE_KEY);
}
