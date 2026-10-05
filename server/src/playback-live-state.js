import { getExclusiveLease, publicLeaseHolder, readPlaybackSession, readViewerId } from "./playback-session.js";

const ACTIVE_INDEX_KEY = "playback:active:index";
const ACTIVE_PLAYING_TTL_SECONDS = 300;
const PAUSE_CACHE_TTL_SECONDS = 1800;

const mediaIdOf = (value) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};
const nonNegative = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;

export function publicPlaybackSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const mediaId = mediaIdOf(value.mediaId);
  const action = value.action;
  if (!mediaId || (action !== "play" && action !== "pause")) return null;
  const timestamp = typeof value.timestamp === "string" && Number.isFinite(Date.parse(value.timestamp))
    ? value.timestamp : null;
  return {
    mediaId, action, state: action === "play" ? "playing" : "paused",
    position: nonNegative(value.position), duration: nonNegative(value.duration),
    loopMode: ["none", "queue", "media"].includes(value.loopMode) ? value.loopMode : "none",
    shuffleEnabled: Boolean(value.shuffleEnabled),
    ...(timestamp ? { updatedAt: timestamp } : {}),
  };
}

export async function publicHolderWithPlayback(redis, lease, expiresIn) {
  const holder = publicLeaseHolder(lease, expiresIn);
  if (!holder || !lease?.viewerId) return holder;
  try {
    const raw = await redis.get(`playback:active:${lease.viewerId}`);
    const playback = raw ? publicPlaybackSnapshot(JSON.parse(raw)) : null;
    if (playback && playback.mediaId === holder.mediaId) holder.playback = playback;
  } catch {}
  return holder;
}

export async function authorizeExclusiveReport(redis, { viewerId, sessionId, clientIp, mediaId, mediaType }) {
  const lease = await getExclusiveLease(redis);
  const targetsExclusiveMedia = Boolean(lease) || /^audio\//.test(mediaType || "") || /^video\//.test(mediaType || "");
  if (!targetsExclusiveMedia) return { authorized: true, lease };
  const session = await readPlaybackSession(redis, sessionId);
  const ownsLease = Boolean(
    mediaIdOf(mediaId) && lease && session && session.leaseRequired
    && Number(session.mediaId) === Number(mediaId) && Number(lease.mediaId) === Number(mediaId)
    && viewerId && session.viewerId === viewerId && lease.viewerId === viewerId
    && lease.sessionId === sessionId && session.clientIp === clientIp && lease.clientIp === clientIp
  );
  return { authorized: ownsLease, lease };
}

export function reportIdentity(request) {
  return {
    viewerId: readViewerId(request),
    sessionId: request.headers["x-playback-session"],
    clientIp: request.clientIp || request.ip,
    mediaId: request.body?.mediaId,
    mediaType: request.body?.mediaType,
  };
}

export async function writeActivePlayback(redis, identity, body) {
  const activeIdentity = identity.viewerId || identity.clientIp;
  const key = `playback:active:${activeIdentity}`;
  const action = body.action;
  if (action === "end") {
    const multi = redis.multi();
    multi.del(key).zrem(ACTIVE_INDEX_KEY, activeIdentity);
    await multi.exec();
    return { ok: true, dropped: true };
  }
  let existing = null;
  try {
    const raw = await redis.get(key);
    if (raw) existing = JSON.parse(raw);
  } catch {}
  let queueTrigger = null;
  if (!body.trigger && !body.nextTrigger && !body.source) {
    try { queueTrigger = await redis.get(`queue:trigger:${identity.clientIp}`); } catch {}
  }
  const now = new Date().toISOString();
  const pausedAt = action === "pause" ? (body.pausedAt || (existing?.action === "pause" ? existing.pausedAt : now)) : null;
  if (pausedAt && Number.isFinite(Date.parse(pausedAt)) && Date.now() - Date.parse(pausedAt) >= PAUSE_CACHE_TTL_SECONDS * 1000) {
    const multi = redis.multi();
    multi.del(key).zrem(ACTIVE_INDEX_KEY, activeIdentity);
    await multi.exec();
    return { ok: true, dropped: true, reason: "pause_timeout" };
  }
  const event = {
    mediaId: mediaIdOf(body.mediaId), title: body.title,
    action, state: action === "pause" ? "paused" : action === "play" ? "playing" : action,
    position: nonNegative(body.position), duration: nonNegative(body.duration),
    loopMode: ["none", "queue", "media"].includes(body.loopMode) ? body.loopMode : "none",
    shuffleEnabled: Boolean(body.shuffleEnabled),
    trigger: ["system", "user"].includes(body.trigger || body.nextTrigger || body.source)
      ? body.trigger || body.nextTrigger || body.source
      : ["system", "user"].includes(queueTrigger) ? queueTrigger : existing?.trigger || "user",
    pausedAt,
    ip: identity.clientIp, timestamp: now,
  };
  const ttl = action === "pause" ? PAUSE_CACHE_TTL_SECONDS : ACTIVE_PLAYING_TTL_SECONDS;
  const multi = redis.multi();
  multi.set(key, JSON.stringify(event), "EX", ttl).zadd(ACTIVE_INDEX_KEY, Date.now() + ttl * 1000, activeIdentity);
  await multi.exec();
  return { ok: true, trigger: event.trigger, state: event.state };
}
