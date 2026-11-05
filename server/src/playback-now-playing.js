const ACTIVE_INDEX_KEY = "playback:active:index";
export const PAUSE_MAX_IDLE_MS = 30 * 60 * 1000;

export function isSessionPauseExpired(session, now = Date.now()) {
  if (!session || (session.action !== "pause" && session.state !== "paused")) return false;
  const pausedAt = Date.parse(session.pausedAt || session.timestamp);
  return Number.isFinite(pausedAt) && now - pausedAt >= PAUSE_MAX_IDLE_MS;
}

export async function hydrateSessionTitles(fastify, sessions) {
  const mediaIds = [...new Set(sessions.map((session) => Number(session.mediaId)).filter(Number.isFinite))];
  if (mediaIds.length === 0) return sessions;
  const placeholders = mediaIds.map((_, index) => `$${index + 1}`).join(", ");
  try {
    const { rows } = await fastify.pg.query(`SELECT id, title FROM media_assets WHERE id IN (${placeholders})`, mediaIds);
    const titles = new Map(rows.map((row) => [Number(row.id), row.title]));
    for (const session of sessions) {
      const title = titles.get(Number(session.mediaId));
      if (title) session.title = title;
    }
  } catch (error) {
    fastify.log.warn(error, "failed to hydrate playback session titles");
  }
  return sessions;
}

async function hydrateSessionUsers(fastify, sessions) {
  const userIds = [...new Set(sessions.map((session) => Number(session.userId)).filter((id) => Number.isFinite(id) && id > 0))];
  if (userIds.length === 0) return sessions;
  const placeholders = userIds.map((_, index) => `$${index + 1}`).join(", ");
  try {
    const { rows } = await fastify.pg.query(`SELECT id, username, profile_picture FROM users WHERE id IN (${placeholders})`, userIds);
    const users = new Map(rows.map((row) => [Number(row.id), row]));
    for (const session of sessions) {
      const user = users.get(Number(session.userId));
      if (user) {
        session.username = user.username;
        session.profilePicture = user.profile_picture || "fine";
      }
    }
  } catch (error) {
    fastify.log.warn(error, "failed to hydrate playback session users");
  }
  return sessions;
}

export async function listNowPlayingSessions(fastify) {
  const redis = fastify.redis;
  const now = Date.now();
  await redis.zremrangebyscore(ACTIVE_INDEX_KEY, "-inf", now);
  const identities = await redis.zrangebyscore(ACTIVE_INDEX_KEY, now, "+inf");
  if (identities.length === 0) return [];

  const values = await redis.mget(identities.map((identity) => `playback:active:${identity}`));
  const sessions = [];
  const expired = [];
  for (let index = 0; index < identities.length; index += 1) {
    if (!values[index]) {
      expired.push(identities[index]);
      continue;
    }
    let data;
    try { data = JSON.parse(values[index]); } catch {
      expired.push(identities[index]);
      continue;
    }
    if (isSessionPauseExpired(data, now)) {
      expired.push(identities[index]);
      continue;
    }
    sessions.push({ ip: identities[index], ...data });
  }
  if (expired.length) {
    const multi = redis.multi();
    for (const identity of expired) {
      multi.del(`playback:active:${identity}`).zrem(ACTIVE_INDEX_KEY, identity);
    }
    await multi.exec();
  }
  await hydrateSessionTitles(fastify, sessions);
  await hydrateSessionUsers(fastify, sessions);
  return sessions;
}
