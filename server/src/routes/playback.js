import Redis from "ioredis";

const fallbackRedis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
const DASHBOARD_CACHE_TTL_SECONDS = 30 * 60;
const DASHBOARD_LOOKBACK_DAYS = 90;

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

function normalizePositiveMediaId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDashboardView(value) {
  return value === "liked" ? "liked" : "all";
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

function standardUserPlaybackEventsSql(selectSql) {
  return `
    WITH standard_user_events AS (
      SELECT pe.*
      FROM playback_events pe
      LEFT JOIN LATERAL (
        SELECT access_tier
        FROM ip_whitelist
        WHERE pe.client_ip <<= cidr_range
        ORDER BY masklen(cidr_range) DESC
        LIMIT 1
      ) access ON true
      WHERE pe.occurred_at >= $1
        AND pe.occurred_at <= $2
        AND access.access_tier < 100
    )
    ${selectSql}
  `;
}

async function standardUserIps(fastify, ips) {
  const uniqueIps = [...new Set(ips.filter(Boolean))];
  if (uniqueIps.length === 0) return new Set();

  const values = uniqueIps.map((_, index) => `($${index + 1}::inet)`).join(", ");
  const { rows } = await fastify.pg.query(
    `WITH event_ips(ip) AS (VALUES ${values})
     SELECT event_ips.ip::text AS ip,
            access.access_tier::int AS access_tier
     FROM event_ips
     LEFT JOIN LATERAL (
       SELECT access_tier
       FROM ip_whitelist
       WHERE event_ips.ip <<= cidr_range
       ORDER BY masklen(cidr_range) DESC
       LIMIT 1
     ) access ON true`,
    uniqueIps
  );

  return new Set(rows.filter((row) => Number.isFinite(row.access_tier) && row.access_tier < 100).map((row) => row.ip));
}

async function getWrappedFromDb(fastify, from, to) {
  const params = [from.toISOString(), to.toISOString()];
  const [{ rows: totalRows }, { rows: topMediaRows }, { rows: timelineRows }] = await Promise.all([
    fastify.pg.query(
      standardUserPlaybackEventsSql(`SELECT
         COALESCE(SUM(CASE WHEN action IN ('pause', 'end') THEN position ELSE 0 END), 0)::int AS total_play_time,
         COUNT(*) FILTER (WHERE action = 'play')::int AS total_plays
       FROM standard_user_events`),
      params
    ),
    fastify.pg.query(
      standardUserPlaybackEventsSql(`SELECT
         pe.media_id,
         COALESCE(MAX(ma.title), MAX(pe.title), 'Media #' || pe.media_id::text) AS title,
         COUNT(*) FILTER (WHERE pe.action = 'play')::int AS play_count,
         COALESCE(SUM(CASE WHEN pe.action IN ('pause', 'end') THEN pe.position ELSE 0 END), 0)::int AS total_time
       FROM standard_user_events pe
       LEFT JOIN media_assets ma ON ma.id = pe.media_id
       WHERE pe.media_id IS NOT NULL
       GROUP BY pe.media_id
       ORDER BY total_time DESC, play_count DESC, pe.media_id ASC
       LIMIT 5`),
      params
    ),
    fastify.pg.query(
      standardUserPlaybackEventsSql(`SELECT
         occurred_at::date AS activity_date,
         COALESCE(SUM(CASE WHEN action IN ('pause', 'end') THEN position ELSE 0 END), 0)::int AS play_time,
         COUNT(*) FILTER (WHERE action = 'play')::int AS plays
       FROM standard_user_events
       GROUP BY occurred_at::date
       ORDER BY occurred_at::date`),
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

  const allEvents = raw.map((s) => JSON.parse(s));
  const allowedIps = await standardUserIps(fastify, allEvents.map((event) => event.ip));
  const events = allEvents.filter((event) => allowedIps.has(event.ip));
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

function orderedIds(items, filter = () => true, sorter = null, limit = 14) {
  const source = items.filter(filter);
  if (sorter) source.sort(sorter);
  return source.slice(0, limit).map((item) => item.id);
}

function idsByPlaybackScore(items, filter = () => true, limit = 14) {
  return orderedIds(
    items,
    filter,
    (a, b) =>
      b.playbackScore - a.playbackScore ||
      b.totalTime - a.totalTime ||
      b.playCount - a.playCount ||
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0) ||
      a.title.localeCompare(b.title),
    limit
  );
}

function idsByRecentPlayback(items, filter = () => true, limit = 14) {
  return orderedIds(
    items,
    (item) => filter(item) && item.lastPlayedAt,
    (a, b) =>
      new Date(b.lastPlayedAt || 0) - new Date(a.lastPlayedAt || 0) ||
      b.playbackScore - a.playbackScore ||
      a.title.localeCompare(b.title),
    limit
  );
}

function fallbackIds(items, filter = () => true, limit = 14) {
  return orderedIds(
    items,
    filter,
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0) || a.title.localeCompare(b.title),
    limit
  );
}

function withFallback(primaryIds, fallbackIdList, limit = 14) {
  const seen = new Set();
  const ids = [];

  for (const id of [...primaryIds, ...fallbackIdList]) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || seen.has(numericId)) continue;
    seen.add(numericId);
    ids.push(numericId);
    if (ids.length >= limit) break;
  }

  return ids;
}

function buildDashboardSummary(items, options = {}) {
  const hasPlayback = items.some((item) => item.playCount > 0 || item.totalTime > 0 || item.lastPlayedAt);
  const lastPlayedAt = items
    .map((item) => item.lastPlayedAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;
  const allFallback = fallbackIds(items, () => true, 24);
  const playedIds = hasPlayback ? idsByPlaybackScore(items, () => true, 24) : [];
  const recentIds = hasPlayback ? idsByRecentPlayback(items, () => true, 24) : [];
  const audioIds = hasPlayback ? idsByPlaybackScore(items, (item) => item.mimeType?.startsWith("audio/"), 14) : [];
  const recentAudioIds = hasPlayback ? idsByRecentPlayback(items, (item) => item.mimeType?.startsWith("audio/"), 14) : [];
  const videoIds = hasPlayback ? idsByPlaybackScore(items, (item) => item.mimeType?.startsWith("video/"), 14) : [];
  const imageIds = hasPlayback ? idsByRecentPlayback(items, (item) => item.mimeType?.startsWith("image/"), 14) : [];

  const featuredId = withFallback(playedIds, allFallback, 1)[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    refreshIntervalSeconds: DASHBOARD_CACHE_TTL_SECONDS,
    source: hasPlayback ? "playback_events" : "media_assets",
    filters: {
      view: options.view || "all",
      categoryId: options.categoryId || null,
    },
    stats: {
      totalPlayTime: items.reduce((sum, item) => sum + Math.max(0, Number(item.totalTime) || 0), 0),
      totalPlays: items.reduce((sum, item) => sum + Math.max(0, Number(item.playCount) || 0), 0),
      activeMediaCount: items.filter((item) => item.playCount > 0 || item.totalTime > 0 || item.lastPlayedAt).length,
      mediaCount: items.length,
      lastPlayedAt,
    },
    featuredId,
    quickAccessIds: withFallback(recentIds, withFallback(playedIds, allFallback, 24), 8),
    rows: [
      {
        key: "recently-played",
        title: hasPlayback ? "Recently played" : "Recently added",
        type: "square",
        mediaIds: withFallback(recentIds, allFallback, 14),
      },
      {
        key: "top-media",
        title: hasPlayback ? "Most played" : "Library picks",
        type: "square",
        mediaIds: withFallback(playedIds, allFallback, 14),
      },
      {
        key: "artists-and-voices",
        title: "Artists and voices",
        type: "profile",
        mediaIds: withFallback(audioIds, fallbackIds(items, (item) => item.mimeType?.startsWith("audio/"), 14), 14),
      },
      {
        key: "playlists",
        title: "Playlists from this view",
        type: "playlist",
        mediaIds: withFallback(playedIds.slice(4), allFallback.slice(4), 14),
      },
      {
        key: "podcasts",
        title: "Podcast-style listens",
        type: "podcast",
        mediaIds: withFallback(recentAudioIds.slice(2), fallbackIds(items, (item) => item.mimeType?.startsWith("audio/"), 14), 14),
      },
      {
        key: "stations",
        title: "Video stations",
        type: "radio",
        mediaIds: withFallback(videoIds, fallbackIds(items, (item) => item.mimeType?.startsWith("video/"), 14), 14),
      },
      {
        key: "photo-shelf",
        title: "Photo shelf",
        type: "square",
        mediaIds: withFallback(imageIds, fallbackIds(items, (item) => item.mimeType?.startsWith("image/"), 14), 14),
      },
    ],
  };
}

async function getDashboardSummaryFromDb(fastify, request, { view, categoryId }) {
  const params = [request.accessTier, DASHBOARD_LOOKBACK_DAYS];
  let likedJoin = "";
  let whereSql = "";

  if (view === "liked") {
    params.push(request.clientIp || request.ip);
    likedJoin = `JOIN liked_music lm ON lm.media_id = m.id AND lm.client_ip = $${params.length}::inet`;
    whereSql += " AND m.mime_type LIKE 'audio/%'";
  }

  if (categoryId !== null) {
    params.push(categoryId);
    whereSql += ` AND m.category_id = $${params.length}`;
  }

  const { rows } = await fastify.pg.query(
    `WITH RECURSIVE accessible_categories AS (
       SELECT
         c.id,
         c.parent_id,
         c.min_access_tier,
         c.name,
         ARRAY[c.name::text]::text[] AS path_parts
       FROM categories c
       WHERE c.parent_id IS NULL
         AND c.min_access_tier <= $1
       UNION ALL
       SELECT
         c.id,
         c.parent_id,
         c.min_access_tier,
         c.name,
         ac.path_parts || c.name::text
       FROM categories c
       JOIN accessible_categories ac ON c.parent_id = ac.id
       WHERE c.min_access_tier <= $1
     ),
     playback_stats AS (
       SELECT
         pe.media_id,
         COUNT(*) FILTER (WHERE pe.action = 'play')::int AS play_count,
         COALESCE(SUM(CASE WHEN pe.action IN ('pause', 'end') THEN pe.position ELSE 0 END), 0)::int AS total_time,
         MAX(pe.occurred_at) AS last_played_at
       FROM playback_events pe
       WHERE pe.media_id IS NOT NULL
         AND pe.occurred_at >= NOW() - ($2::int * INTERVAL '1 day')
       GROUP BY pe.media_id
     )
     SELECT
       m.id,
       m.title,
       m.mime_type,
       m.created_at,
       COALESCE(ps.play_count, 0)::int AS play_count,
       COALESCE(ps.total_time, 0)::int AS total_time,
       ps.last_played_at,
       (
         COALESCE(ps.total_time, 0) +
         COALESCE(ps.play_count, 0) * 180 +
         CASE WHEN ps.last_played_at IS NULL THEN 0 ELSE GREATEST(0, 100000 - EXTRACT(EPOCH FROM (NOW() - ps.last_played_at)) / 60)::int END
       )::int AS playback_score
     FROM media_assets m
     JOIN accessible_categories ac ON ac.id = m.category_id
     ${likedJoin}
     LEFT JOIN playback_stats ps ON ps.media_id = m.id
     WHERE 1 = 1
     ${whereSql}
     ORDER BY playback_score DESC, ps.last_played_at DESC NULLS LAST, m.created_at DESC, m.title ASC`,
    params
  );

  return buildDashboardSummary(
    rows.map((row) => ({
      id: Number(row.id),
      title: row.title || "",
      mimeType: row.mime_type || "",
      createdAt: row.created_at,
      playCount: row.play_count || 0,
      totalTime: row.total_time || 0,
      lastPlayedAt: row.last_played_at,
      playbackScore: row.playback_score || 0,
    })),
    { view, categoryId }
  );
}

async function getCachedDashboardSummary(fastify, request) {
  const redis = getRedis(fastify);
  const view = normalizeDashboardView(request.query.view);
  const categoryId = normalizePositiveMediaId(request.query.category_id);
  const ownerPart = view === "liked" ? `:${request.clientIp || request.ip}` : "";
  const cacheKey = `playback:dashboard:v1:tier:${request.accessTier}:view:${view}:category:${categoryId || "all"}${ownerPart}`;

  const cached = await redis.get(cacheKey);
  if (cached) {
    return { ...JSON.parse(cached), cached: true };
  }

  try {
    const summary = await getDashboardSummaryFromDb(fastify, request, { view, categoryId });
    await redis.set(cacheKey, JSON.stringify(summary), "EX", DASHBOARD_CACHE_TTL_SECONDS);
    return { ...summary, cached: false };
  } catch (err) {
    if (err.code !== "42P01") throw err;
    fastify.log.warn("playback_events table is missing; dashboard summary will use media fallback");
    const summary = await buildDashboardSummary([], { view, categoryId });
    await redis.set(cacheKey, JSON.stringify(summary), "EX", DASHBOARD_CACHE_TTL_SECONDS);
    return { ...summary, cached: false };
  }
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

  fastify.get("/dashboard", async (request) => {
    return getCachedDashboardSummary(fastify, request);
  });
}
