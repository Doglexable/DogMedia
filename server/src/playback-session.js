import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const PLAYBACK_SESSION_HEADER = "x-playback-session";
export const VIEWER_ID_HEADER = "x-viewer-id";
export const EXCLUSIVE_PLAYBACK_ENABLED = process.env.EXCLUSIVE_PLAYBACK_ENABLED !== "false";
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
const SOCKET_TICKET_TTL_SECONDS = 30;

export function socketTicketKey(ticket) {
  return `playback:socket-ticket:${createHash("sha256").update(ticket).digest("hex")}`;
}

export async function issueSocketTicket(redis, details) {
  const ticket = randomBytes(32).toString("base64url");
  await redis.set(socketTicketKey(ticket), JSON.stringify(details), "EX", SOCKET_TICKET_TTL_SECONDS);
  return ticket;
}

export async function consumeSocketTicket(redis, ticket, clientIp) {
  if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
  const raw = await redis.getdel(socketTicketKey(ticket));
  if (!raw) return null;
  try {
    const details = JSON.parse(raw);
    return details.clientIp === clientIp ? details : null;
  } catch {
    return null;
  }
}

const ACQUIRE_LEASE_SCRIPT = `
local currentRaw = redis.call('GET', KEYS[1])
local previousSessionId = ''
if currentRaw then
  local current = cjson.decode(currentRaw)
  if current.viewerId ~= ARGV[1] or current.clientIp ~= ARGV[2] then
    return {0, currentRaw, redis.call('PTTL', KEYS[1])}
  end
  previousSessionId = current.sessionId or ''
end
redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4])
return {1, tonumber(ARGV[4]), previousSessionId}
`;

const REFRESH_LEASE_SCRIPT = `
local currentRaw = redis.call('GET', KEYS[1])
if not currentRaw then return {0, -2} end
local current = cjson.decode(currentRaw)
if current.viewerId ~= ARGV[1] or current.sessionId ~= ARGV[2] or current.clientIp ~= ARGV[3] then
  return {0, currentRaw, redis.call('PTTL', KEYS[1])}
end
current.lastHeartbeatAt = tonumber(ARGV[4])
redis.call('SET', KEYS[1], cjson.encode(current), 'PX', ARGV[5])
return {1, tonumber(ARGV[5])}
`;

const RELEASE_LEASE_SCRIPT = `
local currentRaw = redis.call('GET', KEYS[1])
if not currentRaw then return 0 end
local current = cjson.decode(currentRaw)
if current.viewerId ~= ARGV[1] then return 0 end
if ARGV[2] ~= '' and current.sessionId ~= ARGV[2] then return 0 end
if current.clientIp ~= ARGV[3] then return 0 end
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
    mediaType: typeof details.mediaType === "string" ? details.mediaType : "",
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

export function requiresExclusiveLease(_accessTier, mimeType) {
  return EXCLUSIVE_PLAYBACK_ENABLED
    && (mimeType?.startsWith("audio/") || mimeType?.startsWith("video/"));
}

const HOLDER_PLATFORMS = ["web", "desktop", "mobile"];
const PLATFORM_DISPLAY_LABELS = {
  web: "Dogmedia Web",
  desktop: "Dogmedia Desktop",
  mobile: "Dogmedia Mobile",
};

/// Normalize a client-supplied device label (`X-Client-Name`) into a safe
/// display string. Never derives identity from viewer/session IDs or IPs.
export function normalizeDeviceLabel(value, platform) {
  const fallback = PLATFORM_DISPLAY_LABELS[platform] || "Another device";
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return Array.from(cleaned).slice(0, 64).join("").trimEnd();
}

/// Build the public holder descriptor for conflict/status responses.
/// Contains only safe display metadata — never viewer/session IDs or IPs.
export function publicLeaseHolder(lease, expiresIn) {
  if (!lease || typeof lease !== "object") return null;
  if (!HOLDER_PLATFORMS.includes(lease.platform)) return null;
  const platform = lease.platform;
  const mediaId = Number(lease.mediaId);
  const holder = {
    platform,
    deviceLabel: normalizeDeviceLabel(lease.deviceLabel, lease.platform),
    expiresIn: Math.max(0, Math.floor(Number(expiresIn) || 0)),
  };
  if (Number.isInteger(mediaId) && mediaId > 0) holder.mediaId = mediaId;
  return holder;
}

function parseLeaseHolder(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function retryAfterSeconds(ttlMs) {
  return Math.max(1, Math.ceil(Math.max(0, Number(ttlMs) || 0) / 1000));
}

export async function acquireExclusiveLease(redis, details) {
  const now = Date.now();
  const platform = details.platform || "web";
  const lease = {
    viewerId: details.viewerId,
    sessionId: details.sessionId,
    mediaId: Number(details.mediaId),
    clientIp: String(details.clientIp),
    platform,
    deviceLabel: normalizeDeviceLabel(details.deviceLabel, platform),
    acquiredAt: now,
    lastHeartbeatAt: now,
  };
  const ttlMs = EXCLUSIVE_PLAYBACK_LEASE_SECONDS * 1000;
  const result = await redis.eval(
    ACQUIRE_LEASE_SCRIPT,
    1,
    EXCLUSIVE_LEASE_KEY,
    String(details.viewerId),
    String(details.clientIp),
    JSON.stringify(lease),
    ttlMs
  );
  const acquired = Number(result?.[0]) === 1;
  return {
    acquired,
    retryAfter: retryAfterSeconds(acquired ? result?.[1] : result?.[2]),
    previousSessionId: acquired ? result?.[2] || null : null,
    holder: acquired ? null : parseLeaseHolder(result?.[1]),
    lease,
  };
}

export async function refreshExclusiveLease(redis, viewerId, sessionId, clientIp) {
  const ttlMs = EXCLUSIVE_PLAYBACK_LEASE_SECONDS * 1000;
  const result = await redis.eval(
    REFRESH_LEASE_SCRIPT,
    1,
    EXCLUSIVE_LEASE_KEY,
    viewerId,
    sessionId,
    String(clientIp),
    Date.now(),
    ttlMs
  );
  const refreshed = Number(result?.[0]) === 1;
  const conflictRaw = !refreshed && typeof result?.[1] === "string" ? result[1] : null;
  return {
    refreshed,
    retryAfter: retryAfterSeconds(refreshed ? result?.[1] : result?.[2]),
    holder: conflictRaw ? parseLeaseHolder(conflictRaw) : null,
  };
}

export async function releaseExclusiveLease(redis, viewerId, sessionId = "", clientIp) {
  return Number(await redis.eval(
    RELEASE_LEASE_SCRIPT,
    1,
    EXCLUSIVE_LEASE_KEY,
    viewerId,
    sessionId || "",
    String(clientIp)
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
