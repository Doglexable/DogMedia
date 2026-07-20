import Redis from "ioredis";

const fallbackRedis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

function getRedis(fastify) {
  if (fastify.redis) return fastify.redis;
  fastify.log.warn("fastify.redis is undefined, using fallback redis");
  return fallbackRedis;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function subDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() - n);
  return r;
}

function normalizeDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function formatDate(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function normalizeNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeMediaId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePlaybackAction(value) {
  const action = typeof value === "string" ? value : "";
  return ["play", "pause", "end", "skip"].includes(action) ? action : null;
}

function normalizeLoopMode(value) {
  return ["none", "queue", "media"].includes(value) ? value : "none";
}

function buildPlaybackEvent(request, body = {}) {
  const { mediaId, action, position, duration, title, loopMode, shuffleEnabled } = body;
  return {
    mediaId: normalizeMediaId(mediaId),
    title,
    action,
    position: normalizeNonNegativeInt(position),
    duration: normalizeNonNegativeInt(duration),
    loopMode: normalizeLoopMode(loopMode),
    shuffleEnabled: Boolean(shuffleEnabled),
    ip: request.clientIp || request.ip,
    timestamp: new Date().toISOString(),
  };
}

async function hydrateSessionTitles(fastify, sessions) {
  const mediaIds = [
    ...new Set(
      sessions
        .map((session) => Number(session.mediaId))
        .filter(Number.isFinite)
    ),
  ];

  if (mediaIds.length === 0) return sessions;

  const placeholders = mediaIds.map((_, index) => `$${index + 1}`).join(", ");

  try {
    const { rows } = await fastify.pg.query(
      `SELECT id, title FROM media_assets WHERE id IN (${placeholders})`,
      mediaIds
    );
    const titleById = new Map(rows.map((row) => [Number(row.id), row.title]));

    for (const session of sessions) {
      const dbTitle = titleById.get(Number(session.mediaId));
      if (dbTitle) session.title = dbTitle;
    }
  } catch (err) {
    fastify.log.warn(err, "failed to hydrate playback session titles");
  }

  return sessions;
}

async function storePlaybackEvent(fastify, event) {
  try {
    await fastify.pg.query(
      `INSERT INTO playback_events
       (media_id, client_ip, action, position, duration, title, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.mediaId,
        event.ip,
        event.action,
        event.position,
        event.duration,
        event.title || null,
        event.timestamp,
      ]
    );
  } catch (err) {
    if (err.code === "42P01") {
      fastify.log.warn("playback_events table is missing; run migrations to persist wrapped data");
      return;
    }
    throw err;
  }
}

async function getWrappedFromDb(fastify, from, to) {
  const params = [from.toISOString(), to.toISOString()];
  const [{ rows: totalRows }, { rows: topMediaRows }, { rows: timelineRows }] = await Promise.all([
    fastify.pg.query(
      `SELECT
         COALESCE(SUM(CASE WHEN action IN ('pause', 'end') THEN position ELSE 0 END), 0)::int AS total_play_time,
         COUNT(*) FILTER (WHERE action = 'play')::int AS total_plays
       FROM playback_events
       WHERE occurred_at >= $1 AND occurred_at <= $2`,
      params
    ),
    fastify.pg.query(
      `SELECT
         pe.media_id,
         COALESCE(MAX(ma.title), MAX(pe.title), 'Media #' || pe.media_id::text) AS title,
         COUNT(*) FILTER (WHERE pe.action = 'play')::int AS play_count,
         COALESCE(SUM(CASE WHEN pe.action IN ('pause', 'end') THEN pe.position ELSE 0 END), 0)::int AS total_time
       FROM playback_events pe
       LEFT JOIN media_assets ma ON ma.id = pe.media_id
       WHERE pe.occurred_at >= $1
         AND pe.occurred_at <= $2
         AND pe.media_id IS NOT NULL
       GROUP BY pe.media_id
       ORDER BY total_time DESC, play_count DESC, pe.media_id ASC
       LIMIT 5`,
      params
    ),
    fastify.pg.query(
      `SELECT
         occurred_at::date AS activity_date,
         COALESCE(SUM(CASE WHEN action IN ('pause', 'end') THEN position ELSE 0 END), 0)::int AS play_time,
         COUNT(*) FILTER (WHERE action = 'play')::int AS plays
       FROM playback_events
       WHERE occurred_at >= $1 AND occurred_at <= $2
       GROUP BY occurred_at::date
       ORDER BY occurred_at::date`,
      params
    ),
  ]);

  return {
    totalPlayTime: totalRows[0]?.total_play_time || 0,
    totalPlays: totalRows[0]?.total_plays || 0,
    topMedia: topMediaRows.map((row, index) => ({
      mediaId: row.media_id,
      title: row.title,
      playCount: row.play_count,
      totalTime: row.total_time,
      rank: index + 1,
    })),
    timeline: timelineRows.map((row) => ({
      date: formatDate(row.activity_date),
      playTime: row.play_time,
      plays: row.plays,
    })),
  };
}

async function getWrappedFromRedis(fastify, from, to) {
  const redis = getRedis(fastify);
  const raw = await redis.zrangebyscore(
    "playback:events",
    from.getTime(),
    to.getTime()
  );

  const events = raw.map((s) => JSON.parse(s));
  const mediaMap = {};
  const dayBuckets = {};

  for (const e of events) {
    if (e.action === "play" || e.action === "pause") {
      if (!mediaMap[e.mediaId]) {
        mediaMap[e.mediaId] = {
          mediaId: e.mediaId,
          title: e.title || `Media #${e.mediaId}`,
          playCount: 0,
          totalTime: 0,
        };
      }
      mediaMap[e.mediaId].playCount += 1;
    }

    if (e.action === "pause" || e.action === "end") {
      if (mediaMap[e.mediaId] && e.position) {
        mediaMap[e.mediaId].totalTime += Math.floor(e.position);
      }
    }

    const day = startOfDay(new Date(e.timestamp || e.timestamp))
      .toISOString()
      .slice(0, 10);
    if (!dayBuckets[day]) {
      dayBuckets[day] = { date: day, playTime: 0, plays: 0 };
    }
    dayBuckets[day].plays += 1;
    if (e.action === "pause" || e.action === "end") {
      dayBuckets[day].playTime += Math.floor(e.position || 0);
    }
  }

  const topMedia = Object.values(mediaMap)
    .sort((a, b) => b.totalTime - a.totalTime)
    .slice(0, 5);

  const missingTitleIds = [
    ...new Set(
      topMedia
        .filter((media) => !media.title || media.title === `Media #${media.mediaId}`)
        .map((media) => Number(media.mediaId))
        .filter(Number.isFinite)
    ),
  ];

  if (missingTitleIds.length > 0) {
    const placeholders = missingTitleIds.map((_, index) => `$${index + 1}`).join(", ");
    const { rows } = await fastify.pg.query(
      `SELECT id, title FROM media_assets WHERE id IN (${placeholders})`,
      missingTitleIds
    );
    const titleById = new Map(rows.map((row) => [Number(row.id), row.title]));

    for (const media of topMedia) {
      media.title = titleById.get(Number(media.mediaId)) || media.title;
    }
  }

  const timeline = Object.values(dayBuckets).sort(
    (a, b) => a.date.localeCompare(b.date)
  );

  const totalPlayTime = events
    .filter((e) => e.action === "pause" || e.action === "end")
    .reduce((sum, e) => sum + Math.floor(e.position || 0), 0);

  const totalPlays = events.filter(
    (e) => e.action === "play"
  ).length;

  return { totalPlayTime, totalPlays, topMedia, timeline };
}

export default async function (fastify) {
  fastify.post("/event", async (request, reply) => {
    const normalizedAction = normalizePlaybackAction(request.body?.action);

    if (!normalizedAction) {
      return reply.code(400).send({ error: "Invalid playback action" });
    }

    const event = buildPlaybackEvent(request, {
      ...request.body,
      action: normalizedAction,
    });
    const now = Date.now();

    const eventsKey = "playback:events";

    const redis = getRedis(fastify);
    const multi = redis.multi();
    multi.zadd(eventsKey, now, JSON.stringify(event));

    const resumeKey = `playback:resume:${event.ip}:${event.mediaId}`;
    if (event.action === "pause") {
      if (event.duration && event.position >= event.duration - 3) {
        multi.del(resumeKey);
      } else {
        const resume = { position: event.position, timestamp: event.timestamp, duration: event.duration };
        multi.set(resumeKey, JSON.stringify(resume), "EX", 604800);
      }
    } else if (event.action === "end") {
      multi.del(resumeKey);
    }

    await multi.exec();
    await storePlaybackEvent(fastify, event);

    return { ok: true };
  });

  fastify.post("/active", async (request, reply) => {
    const normalizedAction = normalizePlaybackAction(request.body?.action);

    if (!normalizedAction) {
      return reply.code(400).send({ error: "Invalid playback action" });
    }

    const event = buildPlaybackEvent(request, {
      ...request.body,
      action: normalizedAction,
    });
    const redis = getRedis(fastify);
    await redis.set(`playback:active:${event.ip}`, JSON.stringify(event), "EX", 300);

    return { ok: true };
  });

  fastify.get("/active", async (request) => {
    const redis = getRedis(fastify);
    const key = `playback:active:${request.clientIp || request.ip}`;
    const raw = await redis.get(key);
    if (!raw) return { active: null };

    const [active] = await hydrateSessionTitles(fastify, [JSON.parse(raw)]);
    return { active };
  });

  fastify.get("/resume/:mediaId", async (request) => {
    const redis = getRedis(fastify);
    const { mediaId } = request.params;
    const key = `playback:resume:${request.clientIp || request.ip}:${mediaId}`;
    const raw = await redis.get(key);
    if (!raw) return { position: null };
    return JSON.parse(raw);
  });

  fastify.post("/resume/:mediaId", async (request) => {
    const redis = getRedis(fastify);
    const { mediaId } = request.params;
    const { position = 0, duration = 0 } = request.body || {};
    const timestamp = new Date().toISOString();
    const resume = {
      position: Math.floor(position || 0),
      duration: Math.floor(duration || 0),
      timestamp,
    };
    const key = `playback:resume:${request.clientIp || request.ip}:${mediaId}`;

    if (resume.duration && resume.position >= resume.duration - 3) {
      await redis.del(key);
      return { ok: true };
    }

    await redis.set(key, JSON.stringify(resume), "EX", 604800);

    return { ok: true };
  });

  fastify.get("/now-playing", async (request) => {
    if (request.accessTier < 100) {
      return [];
    }

    const redis = getRedis(fastify);
    const keys = [];
    let cursor = "0";
    do {
      const result = await redis.scan(
        cursor,
        "MATCH",
        "playback:active:*",
        "COUNT",
        50
      );
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== "0");

    if (keys.length === 0) return [];

    const values = await redis.mget(keys);
    const sessions = [];

    for (let i = 0; i < keys.length; i++) {
      if (!values[i]) continue;
      const data = JSON.parse(values[i]);
      const ip = keys[i].replace("playback:active:", "");
      sessions.push({ ip, ...data });
    }

    await hydrateSessionTitles(fastify, sessions);

    return sessions;
  });

  fastify.get("/wrapped", async (request) => {
    const now = new Date();
    const from = normalizeDate(request.query.from, subDays(now, 30));
    const to = normalizeDate(request.query.to, now);

    try {
      return await getWrappedFromDb(fastify, from, to);
    } catch (err) {
      if (err.code !== "42P01") throw err;
      fastify.log.warn("playback_events table is missing; falling back to Redis wrapped data");
      return getWrappedFromRedis(fastify, from, to);
    }
  });
}
