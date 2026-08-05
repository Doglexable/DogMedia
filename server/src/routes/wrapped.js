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

function getUtcDateParts(value) {
  const date = new Date(value);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

function utcDate(year, month, day, endOfDay = false) {
  return new Date(Date.UTC(year, month, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0));
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

export function getAnnualWrappedAvailability(now = new Date()) {
  const { year, month, day } = getUtcDateParts(now);
  if (month !== 11) return null;

  const openAt = utcDate(year, 11, 15);
  if (day === 15) {
    return {
      available: true,
      wrappedKind: "annual",
      period: {
        kind: "annual-year",
        days: getCalendarDaySpan(utcDate(year - 1, 11, 15), openAt),
        start: utcDate(year - 1, 11, 15).toISOString(),
        end: utcDate(year, 11, 15, true).toISOString(),
      },
      lastOpenedAt: null,
      nextOpenAt: null,
      retryAfterSeconds: 0,
    };
  }

  const nextOpen = day < 15 ? openAt : utcDate(year + 1, 11, 15);
  return {
    available: false,
    wrappedKind: "annual",
    period: { kind: "annual-year" },
    lastOpenedAt: null,
    nextOpenAt: nextOpen.toISOString(),
    retryAfterSeconds: getRetryAfterSeconds(nextOpen, now),
  };
}

function getCalendarDaySpan(from, to) {
  const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.max(Math.floor((toDay - fromDay) / 86400000) + 1, 1);
}

const PERSONA_PALETTES = {
  "night-listener": { accent: "#2DC7C9", secondary: "#FF5A5F" },
  loyalist: { accent: "#FF5A5F", secondary: "#FFD166" },
  explorer: { accent: "#FFD166", secondary: "#2DC7C9" },
  "deep-diver": { accent: "#2DC7C9", secondary: "#FFD166" },
  "steady-signal": { accent: "#FF5A5F", secondary: "#2DC7C9" },
};

function eventValue(event, camelKey, snakeKey = camelKey) {
  return event[camelKey] ?? event[snakeKey];
}

function startOfUtcDay(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function longestDateStreak(days) {
  let longest = 0;
  let current = 0;
  let previous = null;
  for (const day of days) {
    const timestamp = startOfUtcDay(day.date);
    current = previous !== null && timestamp - previous === 86400000 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = timestamp;
  }
  return longest;
}

export function deriveWrappedPersona({ averageSession = 0, distinctMedia = 0, leadShare = 0, nightShare = 0, totalPlayTime = 0 }) {
  let key = "steady-signal";
  let title = "Steady Signal";
  let description = "You kept a measured rhythm and returned when the moment was right.";

  if (totalPlayTime >= 1800) {
    if (nightShare >= 0.5) {
      key = "night-listener";
      title = "Night Listener";
      description = "Your library came alive after dark.";
    } else if (leadShare >= 0.5) {
      key = "loyalist";
      title = "The Loyalist";
      description = "One favorite held the center of your rotation.";
    } else if (distinctMedia >= 8 && leadShare < 0.35) {
      key = "explorer";
      title = "The Explorer";
      description = "You kept moving and gave the whole library a chance.";
    } else if (averageSession >= 1200) {
      key = "deep-diver";
      title = "The Deep Diver";
      description = "When you pressed play, you stayed with it.";
    }
  }

  return { key, title, description, palette: PERSONA_PALETTES[key] };
}

function shiftedDateParts(date, timezoneOffset) {
  const shifted = new Date(date.getTime() - timezoneOffset * 60000);
  return {
    date: shifted.toISOString().slice(0, 10),
    dayIndex: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
  };
}

export function aggregateWrappedEvents(events = [], from = new Date(0), to = new Date(), options = {}) {
  const timezoneOffset = Number.isFinite(Number(options.timezoneOffset))
    ? Math.min(Math.max(Number(options.timezoneOffset), -840), 840)
    : 0;
  const sortedEvents = [...events].sort((a, b) => {
    const timeDiff = new Date(eventValue(a, "occurredAt", "occurred_at")) - new Date(eventValue(b, "occurredAt", "occurred_at"));
    return timeDiff || Number(eventValue(a, "id")) - Number(eventValue(b, "id"));
  });
  const openByMedia = new Map();
  const mediaStats = new Map();
  const categoryStats = new Map();
  const dayStats = new Map();
  const hourTime = Array.from({ length: 24 }, () => 0);
  let totalPlays = 0;
  let totalPlayTime = 0;
  let segmentCount = 0;
  let nightTime = 0;
  let firstPlayAt = null;

  const ensureMedia = (event) => {
    const mediaId = Number(eventValue(event, "mediaId", "media_id"));
    if (!Number.isFinite(mediaId)) return null;
    if (!mediaStats.has(mediaId)) {
      mediaStats.set(mediaId, {
        mediaId,
        title: eventValue(event, "mediaTitle", "media_title") || eventValue(event, "title") || `Media #${mediaId}`,
        playCount: 0,
        totalTime: 0,
      });
    }
    return mediaStats.get(mediaId);
  };

  for (const event of sortedEvents) {
    const action = eventValue(event, "action");
    const media = ensureMedia(event);
    if (!media) continue;
    const mediaId = media.mediaId;
    const occurredAt = new Date(eventValue(event, "occurredAt", "occurred_at"));
    if (Number.isNaN(occurredAt.getTime())) continue;

    if (action === "play") {
      totalPlays += 1;
      media.playCount += 1;
      if (!firstPlayAt) firstPlayAt = occurredAt.toISOString();
      const date = shiftedDateParts(occurredAt, timezoneOffset).date;
      const day = dayStats.get(date) || { date, playTime: 0, plays: 0 };
      day.plays += 1;
      dayStats.set(date, day);
      const categoryId = normalizeNullableInt(eventValue(event, "categoryId", "category_id"));
      const categoryKey = categoryId ?? "unsorted";
      const category = categoryStats.get(categoryKey) || {
        categoryId,
        name: eventValue(event, "categoryName", "category_name") || "Unsorted",
        playCount: 0,
        totalTime: 0,
      };
      category.playCount += 1;
      categoryStats.set(categoryKey, category);
      openByMedia.set(mediaId, {
        occurredAt,
        position: normalizeNonNegativeInt(eventValue(event, "position")),
        duration: normalizeNonNegativeInt(eventValue(event, "duration")),
        categoryKey,
      });
      continue;
    }

    if (!["pause", "end", "skip"].includes(action)) continue;
    const start = openByMedia.get(mediaId);
    if (!start) continue;
    openByMedia.delete(mediaId);

    const endPosition = normalizeNonNegativeInt(eventValue(event, "position"));
    const positionDelta = Math.max(endPosition - start.position, 0);
    const elapsed = Math.max(Math.floor((occurredAt - start.occurredAt) / 1000), 0);
    const remaining = start.duration > 0 ? Math.max(start.duration - start.position, 0) : positionDelta;
    const listened = Math.max(Math.min(positionDelta, elapsed, remaining), 0);
    if (listened <= 0) continue;

    totalPlayTime += listened;
    segmentCount += 1;
    media.totalTime += listened;
    const startParts = shiftedDateParts(start.occurredAt, timezoneOffset);
    const hour = startParts.hour;
    hourTime[hour] += listened;
    if (hour >= 21 || hour < 5) nightTime += listened;

    const date = startParts.date;
    const day = dayStats.get(date) || { date, playTime: 0, plays: 0 };
    day.playTime += listened;
    dayStats.set(date, day);

    const category = categoryStats.get(start.categoryKey);
    category.totalTime += listened;
    categoryStats.set(start.categoryKey, category);
  }

  const topMedia = [...mediaStats.values()]
    .sort((a, b) => b.totalTime - a.totalTime || b.playCount - a.playCount || a.mediaId - b.mediaId)
    .slice(0, 5)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const timeline = [...dayStats.values()].sort((a, b) => a.date.localeCompare(b.date));
  const topCategories = [...categoryStats.values()]
    .sort((a, b) => b.totalTime - a.totalTime || b.playCount - a.playCount)
    .slice(0, 3)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const weekdayTotals = Array.from({ length: 7 }, (_, dayIndex) => ({ dayIndex, playTime: 0, plays: 0 }));
  for (const day of timeline) {
    const weekday = new Date(`${day.date}T00:00:00.000Z`).getUTCDay();
    weekdayTotals[weekday].playTime += day.playTime;
    weekdayTotals[weekday].plays += day.plays;
  }
  const busiestDay = [...timeline].sort((a, b) => b.playTime - a.playTime || b.plays - a.plays)[0] || null;
  const busiestWeekday = weekdayTotals.sort((a, b) => b.playTime - a.playTime || b.plays - a.plays)[0];
  const peakHourTime = Math.max(...hourTime);
  const peakHour = peakHourTime > 0 ? hourTime.indexOf(peakHourTime) : null;
  const distinctMedia = [...mediaStats.values()].filter((item) => item.playCount > 0).length;
  const averageSession = segmentCount ? Math.floor(totalPlayTime / segmentCount) : 0;
  const leadShare = totalPlayTime ? (topMedia[0]?.totalTime || 0) / totalPlayTime : 0;
  const nightShare = totalPlayTime ? nightTime / totalPlayTime : 0;
  const activeDays = timeline.length;
  const persona = deriveWrappedPersona({ averageSession, distinctMedia, leadShare, nightShare, totalPlayTime });

  return {
    period: {
      kind: options.periodKind || "rolling-30-day",
      days: Number.isFinite(Number(options.periodDays)) ? Number(options.periodDays) : 30,
      start: from.toISOString(),
      end: to.toISOString(),
      timezoneOffset,
    },
    totalPlayTime,
    totalPlays,
    topMedia,
    timeline,
    totals: { playTime: totalPlayTime, plays: totalPlays, activeDays, distinctMedia, averageSession },
    rhythm: {
      peakHour,
      nightShare,
      busiestDay,
      busiestWeekday,
      longestStreak: longestDateStreak(timeline),
    },
    milestones: { firstPlayAt, biggestDay: busiestDay },
    topCategories,
    persona,
  };
}

function mapWrappedAccessLock(row) {
  return {
    allowed: row.allowed,
    lastOpenedAt: row.last_opened_at,
    nextOpenAt: row.next_open_at,
  };
}

function getRetryAfterSeconds(nextOpenAt, now = new Date()) {
  const nextOpen = new Date(nextOpenAt);
  if (Number.isNaN(nextOpen.getTime())) return 0;
  return Math.max(Math.ceil((nextOpen.getTime() - now.getTime()) / 1000), 0);
}

function mapWrappedAccessStatus(row) {
  if (!row) {
    return {
      available: true,
      lastOpenedAt: null,
      nextOpenAt: null,
      retryAfterSeconds: 0,
    };
  }

  const retryAfterSeconds = row.available ? 0 : normalizeNonNegativeInt(row.retry_after_seconds);
  return {
    available: row.available,
    lastOpenedAt: row.last_opened_at,
    nextOpenAt: row.next_open_at,
    retryAfterSeconds,
  };
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

export async function acquireWrappedAccessLock(client, clientIp) {
  const { rows } = await client.query(
    `WITH upsert AS (
       INSERT INTO wrapped_access_locks
         (client_ip, last_opened_at, next_open_at, updated_at)
       VALUES ($1::inet, NOW(), NOW() + INTERVAL '30 days', NOW())
       ON CONFLICT (client_ip) DO UPDATE
       SET last_opened_at = NOW(),
           next_open_at = NOW() + INTERVAL '30 days',
           updated_at = NOW()
       WHERE wrapped_access_locks.next_open_at <= NOW()
       RETURNING TRUE AS allowed, last_opened_at, next_open_at
     )
     SELECT allowed, last_opened_at, next_open_at FROM upsert
     UNION ALL
     SELECT FALSE AS allowed, last_opened_at, next_open_at
     FROM wrapped_access_locks
     WHERE client_ip = $1::inet
       AND NOT EXISTS (SELECT 1 FROM upsert)
     LIMIT 1`,
    [clientIp]
  );

  return rows[0] ? mapWrappedAccessLock(rows[0]) : null;
}

export async function getWrappedAccessStatus(client, clientIp) {
  const { rows } = await client.query(
    `SELECT
       last_opened_at,
       next_open_at,
       next_open_at <= NOW() AS available,
       GREATEST(CEIL(EXTRACT(EPOCH FROM (next_open_at - NOW()))), 0)::int AS retry_after_seconds
     FROM wrapped_access_locks
     WHERE client_ip = $1::inet`,
    [clientIp]
  );

  return mapWrappedAccessStatus(rows[0]);
}

async function getCurrentIpWrapped(fastify, request, from, to, timezoneOffset = 0, options = {}) {
  const clientIp = request.clientIp || request.ip;
  const params = [from.toISOString(), to.toISOString(), clientIp];
  const { rows } = await fastify.pg.query(
    `SELECT
       pe.id,
       pe.media_id,
       pe.action,
       pe.position,
       pe.duration,
       pe.title,
       pe.occurred_at,
       ma.title AS media_title,
       ma.category_id,
       c.name AS category_name
     FROM playback_events pe
     LEFT JOIN media_assets ma ON ma.id = pe.media_id
     LEFT JOIN categories c ON c.id = ma.category_id
     WHERE pe.occurred_at >= $1
       AND pe.occurred_at <= $2
       AND pe.client_ip = $3::inet
     ORDER BY pe.occurred_at, pe.id`,
    params
  );
  const wrapped = aggregateWrappedEvents(rows, from, to, { timezoneOffset, ...options });

  return {
    clientIp,
    periodStart: wrapped.period.start,
    periodEnd: wrapped.period.end,
    wrappedKind: options.wrappedKind || "monthly",
    ...wrapped,
  };
}

export default async function (fastify) {
  fastify.get("/access", async (request) => {
    const annual = getAnnualWrappedAvailability(new Date());
    if (annual) return annual;
    return getWrappedAccessStatus(fastify.pg, request.clientIp || request.ip);
  });

  fastify.get("/current", async (request, reply) => {
    const now = new Date();
    const annual = getAnnualWrappedAvailability(now);
    const timezoneOffset = Math.min(Math.max(Number.parseInt(request.query.timezoneOffset, 10) || 0, -840), 840);

    if (annual && !annual.available) {
      return reply
        .code(429)
        .header("Retry-After", String(annual.retryAfterSeconds))
        .send({
          error: "Annual Wrapped opens December 15",
          code: "WRAPPED_LOCKED",
          wrappedKind: annual.wrappedKind,
          period: annual.period,
          lastOpenedAt: null,
          nextOpenAt: annual.nextOpenAt,
          retryAfterSeconds: annual.retryAfterSeconds,
        });
    }

    if (annual?.available) {
      const from = new Date(annual.period.start);
      const to = new Date(annual.period.end);
      const wrapped = await getCurrentIpWrapped(fastify, request, from, to, timezoneOffset, {
        periodKind: annual.period.kind,
        periodDays: annual.period.days,
        wrappedKind: annual.wrappedKind,
      });
      return {
        ...wrapped,
        access: {
          lastOpenedAt: null,
          nextOpenAt: null,
        },
      };
    }

    const from = normalizeDateTime(request.query.from, subDays(now, 30));
    const to = normalizeDateTime(request.query.to, now);

    const clientIp = request.clientIp || request.ip;
    const access = await acquireWrappedAccessLock(fastify.pg, clientIp);

    if (!access?.allowed) {
      const retryAfterSeconds = getRetryAfterSeconds(access?.nextOpenAt, now);
      return reply
        .code(429)
        .header("Retry-After", String(retryAfterSeconds))
        .send({
          error: "Wrapped is locked",
          code: "WRAPPED_LOCKED",
          wrappedKind: "monthly",
          period: { kind: "rolling-30-day", days: 30 },
          lastOpenedAt: access?.lastOpenedAt || null,
          nextOpenAt: access?.nextOpenAt || null,
          retryAfterSeconds,
        });
    }

    const wrapped = await getCurrentIpWrapped(fastify, request, from, to, timezoneOffset);
    return {
      ...wrapped,
      access: {
        lastOpenedAt: access.lastOpenedAt,
        nextOpenAt: access.nextOpenAt,
      },
    };
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
