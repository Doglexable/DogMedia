function requireAdmin(request, reply) {
  if (request.accessTier < 100) {
    reply.code(403).send({ error: "Insufficient tier" });
    return false;
  }
  return true;
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeNullableInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function normalizeDateTime(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function subDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

function mapReport(row) {
  return {
    id: row.id,
    periodStart: formatDate(row.period_start),
    periodEnd: formatDate(row.period_end),
    totalPlayTime: row.total_play_time,
    totalPlays: row.total_plays,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTopMedia(row) {
  return {
    id: row.id,
    mediaId: row.media_id,
    title: row.title,
    playCount: row.play_count,
    totalTime: row.total_time,
    rank: row.rank,
  };
}

function mapTimelineDay(row) {
  return {
    id: row.id,
    date: formatDate(row.activity_date),
    playTime: row.play_time,
    plays: row.plays,
  };
}

async function getWrappedReport(client, id) {
  const { rows } = await client.query("SELECT * FROM wrapped_reports WHERE id = $1", [id]);
  if (rows.length === 0) return null;

  const [{ rows: topMediaRows }, { rows: timelineRows }] = await Promise.all([
    client.query("SELECT * FROM wrapped_top_media WHERE wrapped_report_id = $1 ORDER BY rank", [id]),
    client.query("SELECT * FROM wrapped_timeline_days WHERE wrapped_report_id = $1 ORDER BY activity_date", [id]),
  ]);

  return {
    ...mapReport(rows[0]),
    topMedia: topMediaRows.map(mapTopMedia),
    timeline: timelineRows.map(mapTimelineDay),
  };
}

async function replaceTopMedia(client, reportId, topMedia = []) {
  await client.query("DELETE FROM wrapped_top_media WHERE wrapped_report_id = $1", [reportId]);

  for (const [index, item] of topMedia.entries()) {
    const mediaId = normalizeNullableInt(item.mediaId ?? item.media_id);
    const rank = normalizeNonNegativeInt(item.rank, index + 1);
    const fallbackTitle = mediaId ? `Media #${mediaId}` : `Media ${rank}`;
    const title = typeof item.title === "string" ? item.title.trim() : "";

    await client.query(
      `INSERT INTO wrapped_top_media
       (wrapped_report_id, media_id, title, play_count, total_time, rank)
       VALUES (
         $1,
         $2,
         COALESCE(NULLIF($3, ''), (SELECT title FROM media_assets WHERE id = $2), $4),
         $5,
         $6,
         $7
       )`,
      [
        reportId,
        mediaId,
        title,
        fallbackTitle,
        normalizeNonNegativeInt(item.playCount ?? item.play_count),
        normalizeNonNegativeInt(item.totalTime ?? item.total_time),
        rank,
      ]
    );
  }
}

async function replaceTimeline(client, reportId, timeline = []) {
  await client.query("DELETE FROM wrapped_timeline_days WHERE wrapped_report_id = $1", [reportId]);

  for (const item of timeline) {
    const activityDate = normalizeDate(item.date ?? item.activity_date);
    if (!activityDate) continue;

    await client.query(
      `INSERT INTO wrapped_timeline_days
       (wrapped_report_id, activity_date, play_time, plays)
       VALUES ($1, $2, $3, $4)`,
      [
        reportId,
        activityDate,
        normalizeNonNegativeInt(item.playTime ?? item.play_time),
        normalizeNonNegativeInt(item.plays),
      ]
    );
  }
}

async function withTransaction(fastify, fn) {
  const client = await fastify.pg.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getCurrentIpWrapped(fastify, request, from, to) {
  const clientIp = request.clientIp || request.ip;
  const params = [from.toISOString(), to.toISOString(), clientIp];
  const [{ rows: totalRows }, { rows: topMediaRows }, { rows: timelineRows }] = await Promise.all([
    fastify.pg.query(
      `SELECT
         COALESCE(SUM(CASE WHEN action IN ('pause', 'end') THEN position ELSE 0 END), 0)::int AS total_play_time,
         COUNT(*) FILTER (WHERE action = 'play')::int AS total_plays
       FROM playback_events
       WHERE occurred_at >= $1
         AND occurred_at <= $2
         AND client_ip = $3::inet`,
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
         AND pe.client_ip = $3::inet
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
       WHERE occurred_at >= $1
         AND occurred_at <= $2
         AND client_ip = $3::inet
       GROUP BY occurred_at::date
       ORDER BY occurred_at::date`,
      params
    ),
  ]);

  return {
    clientIp,
    periodStart: from.toISOString(),
    periodEnd: to.toISOString(),
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

export default async function (fastify) {
  fastify.get("/current", async (request) => {
    const now = new Date();
    const from = normalizeDateTime(request.query.from, subDays(now, 30));
    const to = normalizeDateTime(request.query.to, now);

    return getCurrentIpWrapped(fastify, request, from, to);
  });

  fastify.get("/", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const { rows } = await fastify.pg.query(
      `SELECT
         wr.*,
         (SELECT COUNT(*)::int FROM wrapped_top_media wtm WHERE wtm.wrapped_report_id = wr.id) AS top_media_count,
         (SELECT COUNT(*)::int FROM wrapped_timeline_days wtd WHERE wtd.wrapped_report_id = wr.id) AS timeline_count
       FROM wrapped_reports wr
       ORDER BY wr.period_end DESC, wr.created_at DESC`
    );

    return rows.map((row) => ({
      ...mapReport(row),
      topMediaCount: row.top_media_count,
      timelineCount: row.timeline_count,
    }));
  });

  fastify.get("/:id", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const report = await getWrappedReport(fastify.pg, request.params.id);
    if (!report) return reply.code(404).send({ error: "Not found" });
    return report;
  });

  fastify.post("/", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const body = request.body || {};
    const periodStart = normalizeDate(body.periodStart ?? body.period_start);
    const periodEnd = normalizeDate(body.periodEnd ?? body.period_end);

    if (!periodStart || !periodEnd) {
      return reply.code(400).send({ error: "periodStart and periodEnd are required" });
    }

    if (periodEnd < periodStart) {
      return reply.code(400).send({ error: "periodEnd must be on or after periodStart" });
    }

    const created = await withTransaction(fastify, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO wrapped_reports
         (period_start, period_end, total_play_time, total_plays, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          periodStart,
          periodEnd,
          normalizeNonNegativeInt(body.totalPlayTime ?? body.total_play_time),
          normalizeNonNegativeInt(body.totalPlays ?? body.total_plays),
          body.notes ?? null,
        ]
      );

      const reportId = rows[0].id;
      await replaceTopMedia(client, reportId, Array.isArray(body.topMedia) ? body.topMedia : []);
      await replaceTimeline(client, reportId, Array.isArray(body.timeline) ? body.timeline : []);
      return getWrappedReport(client, reportId);
    });

    return reply.code(201).send(created);
  });

  fastify.put("/:id", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const body = request.body || {};
    const existing = await getWrappedReport(fastify.pg, request.params.id);
    if (!existing) return reply.code(404).send({ error: "Not found" });

    const periodStart = Object.hasOwn(body, "periodStart") || Object.hasOwn(body, "period_start")
      ? normalizeDate(body.periodStart ?? body.period_start)
      : existing.periodStart;
    const periodEnd = Object.hasOwn(body, "periodEnd") || Object.hasOwn(body, "period_end")
      ? normalizeDate(body.periodEnd ?? body.period_end)
      : existing.periodEnd;

    if (!periodStart || !periodEnd) {
      return reply.code(400).send({ error: "Invalid periodStart or periodEnd" });
    }

    if (periodEnd < periodStart) {
      return reply.code(400).send({ error: "periodEnd must be on or after periodStart" });
    }

    const updated = await withTransaction(fastify, async (client) => {
      await client.query(
        `UPDATE wrapped_reports
         SET period_start = $1,
             period_end = $2,
             total_play_time = $3,
             total_plays = $4,
             notes = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [
          periodStart,
          periodEnd,
          Object.hasOwn(body, "totalPlayTime") || Object.hasOwn(body, "total_play_time")
            ? normalizeNonNegativeInt(body.totalPlayTime ?? body.total_play_time)
            : existing.totalPlayTime,
          Object.hasOwn(body, "totalPlays") || Object.hasOwn(body, "total_plays")
            ? normalizeNonNegativeInt(body.totalPlays ?? body.total_plays)
            : existing.totalPlays,
          Object.hasOwn(body, "notes") ? body.notes : existing.notes,
          request.params.id,
        ]
      );

      if (Array.isArray(body.topMedia)) {
        await replaceTopMedia(client, request.params.id, body.topMedia);
      }

      if (Array.isArray(body.timeline)) {
        await replaceTimeline(client, request.params.id, body.timeline);
      }

      return getWrappedReport(client, request.params.id);
    });

    return updated;
  });

  fastify.delete("/:id", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;

    const { rowCount } = await fastify.pg.query("DELETE FROM wrapped_reports WHERE id = $1", [request.params.id]);
    if (rowCount === 0) return reply.code(404).send({ error: "Not found" });
    return reply.code(204).send();
  });
}
