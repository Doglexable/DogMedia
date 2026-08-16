import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { join } from "path";
import {
  buildOfflineFileVersion,
  isNewerOfflineResume,
  normalizeOfflineEvent,
  normalizeOfflineMediaId,
  normalizeOfflineResume,
} from "../offline.js";

const DATA_DIR = process.env.DATA_DIR || "data";
const MAX_BATCH_ITEMS = 500;
const ACCESSIBLE_AUDIO_SQL = `
  WITH RECURSIVE accessible_categories AS (
    SELECT c.id, c.parent_id, c.name, ARRAY[c.name::text]::text[] AS path_parts
    FROM categories c
    WHERE c.parent_id IS NULL AND c.min_access_tier <= $1
    UNION ALL
    SELECT c.id, c.parent_id, c.name, ac.path_parts || c.name::text
    FROM categories c
    JOIN accessible_categories ac ON c.parent_id = ac.id
    WHERE c.min_access_tier <= $1
  )
`;

function serializeMedia(row, stats) {
  return {
    id: Number(row.id),
    category_id: Number(row.category_id),
    category_name: row.category_name,
    category_path: row.category_path,
    title: row.title,
    description: row.description,
    artists: row.artists,
    duration: row.duration,
    mime_type: row.mime_type,
    byteSize: Number(stats.size),
    fileVersion: buildOfflineFileVersion(stats),
    hasLyrics: Boolean(row.has_lyrics),
    liked: Boolean(row.liked),
  };
}

async function accessibleAudioRows(fastify, accessTier, clientIp, { categoryId = null, mediaIds = null } = {}) {
  const params = [accessTier, clientIp];
  let filter = "";
  if (categoryId) {
    params.push(categoryId);
    filter = ` AND m.category_id = $${params.length}`;
  } else if (mediaIds) {
    params.push(mediaIds);
    filter = ` AND m.id = ANY($${params.length}::int[])`;
  }
  const { rows } = await fastify.pg.query(
    `${ACCESSIBLE_AUDIO_SQL}
     SELECT m.*, ac.name AS category_name,
            array_to_string(ac.path_parts, ' / ') AS category_path,
            (ml.media_id IS NOT NULL) AS has_lyrics,
            EXISTS (SELECT 1 FROM liked_music lm WHERE lm.media_id = m.id AND lm.client_ip = $2::inet) AS liked
     FROM media_assets m
     JOIN accessible_categories ac ON ac.id = m.category_id
     LEFT JOIN media_lyrics ml ON ml.media_id = m.id
     WHERE m.mime_type LIKE 'audio/%'${filter}
     ORDER BY m.title`,
    params
  );
  return rows;
}

async function manifestItems(rows, dataDir) {
  const items = await Promise.all(rows.map(async (row) => {
    try {
      const stats = await stat(join(dataDir, row.file_path));
      return serializeMedia(row, stats);
    } catch {
      return null;
    }
  }));
  return items.filter(Boolean);
}

async function sendMissingOrDenied(fastify, reply, mediaId) {
  const { rowCount } = await fastify.pg.query("SELECT 1 FROM media_assets WHERE id = $1", [mediaId]);
  return rowCount === 0
    ? reply.code(404).send({ error: "Media not found" })
    : reply.code(403).send({ error: "Access denied" });
}

export default async function offlineRoutes(fastify, options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  fastify.get("/manifest", async (request, reply) => {
    const categoryId = normalizeOfflineMediaId(request.query?.category_id);
    const mediaId = normalizeOfflineMediaId(request.query?.media_id);
    if (!categoryId && !mediaId) return reply.code(400).send({ error: "category_id or media_id is required" });
    const rows = await accessibleAudioRows(fastify, request.accessTier, request.clientIp || request.ip, mediaId ? { mediaIds: [mediaId] } : { categoryId });
    if (mediaId && rows.length === 0) return sendMissingOrDenied(fastify, reply, mediaId);
    return { items: await manifestItems(rows, dataDir) };
  });

  fastify.get("/media/:id/download", async (request, reply) => {
    const mediaId = normalizeOfflineMediaId(request.params.id);
    if (!mediaId) return reply.code(400).send({ error: "Invalid media ID" });
    const rows = await accessibleAudioRows(fastify, request.accessTier, request.clientIp || request.ip, { mediaIds: [mediaId] });
    if (rows.length === 0) return sendMissingOrDenied(fastify, reply, mediaId);
    const media = rows[0];
    const filePath = join(dataDir, media.file_path);
    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      return reply.code(404).send({ error: "File not found on disk" });
    }
    reply.header("Content-Length", stats.size);
    reply.header("X-File-Version", buildOfflineFileVersion(stats));
    reply.header("Content-Disposition", `attachment; filename="${mediaId}"`);
    reply.header("Cache-Control", "no-store, private");
    reply.type(media.mime_type || "application/octet-stream");
    return reply.send(createReadStream(filePath));
  });

  fastify.post("/validate", async (request, reply) => {
    const requested = Array.isArray(request.body?.items) ? request.body.items.slice(0, MAX_BATCH_ITEMS) : [];
    if (!Array.isArray(request.body?.items) || request.body.items.length > MAX_BATCH_ITEMS) {
      return reply.code(400).send({ error: `items must contain at most ${MAX_BATCH_ITEMS} entries` });
    }
    const ids = [...new Set(requested.map((item) => normalizeOfflineMediaId(item?.mediaId)).filter(Boolean))];
    const rows = await accessibleAudioRows(fastify, request.accessTier, request.clientIp || request.ip, { mediaIds: ids });
    const accessible = new Map((await manifestItems(rows, dataDir)).map((item) => [item.id, item]));
    const { rows: existingRows } = ids.length
      ? await fastify.pg.query("SELECT id FROM media_assets WHERE id = ANY($1::int[])", [ids])
      : { rows: [] };
    const existing = new Set(existingRows.map((row) => Number(row.id)));
    return {
      items: requested.map((item) => {
        const mediaId = normalizeOfflineMediaId(item?.mediaId);
        const current = accessible.get(mediaId);
        if (!mediaId || !existing.has(mediaId)) return { mediaId, status: "missing" };
        if (!current) return { mediaId, status: "locked" };
        return {
          mediaId,
          status: current.fileVersion === item.fileVersion ? "valid" : "changed",
          fileVersion: current.fileVersion,
          byteSize: current.byteSize,
        };
      }),
    };
  });

  fastify.post("/sync", async (request, reply) => {
    const rawEvents = Array.isArray(request.body?.events) ? request.body.events : [];
    const rawResumes = Array.isArray(request.body?.resumes) ? request.body.resumes : [];
    if (rawEvents.length > MAX_BATCH_ITEMS || rawResumes.length > MAX_BATCH_ITEMS) {
      return reply.code(400).send({ error: `sync batches are limited to ${MAX_BATCH_ITEMS} entries` });
    }
    const events = rawEvents.map(normalizeOfflineEvent).filter(Boolean);
    const resumes = rawResumes.map(normalizeOfflineResume).filter(Boolean);
    if (events.length !== rawEvents.length || resumes.length !== rawResumes.length) {
      return reply.code(400).send({ error: "Invalid synchronization payload" });
    }
    const ids = [...new Set([...events, ...resumes].map((item) => item.mediaId))];
    const allowedRows = await accessibleAudioRows(fastify, request.accessTier, request.clientIp || request.ip, { mediaIds: ids });
    const allowed = new Set(allowedRows.map((row) => Number(row.id)));
    const clientIp = request.clientIp || request.ip;
    const acceptedEventIds = [];
    for (const event of events) {
      if (!allowed.has(event.mediaId)) continue;
      const { rowCount } = await fastify.pg.query(
        `INSERT INTO playback_events
         (media_id, client_ip, action, position, duration, title, occurred_at, client_event_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING`,
        [event.mediaId, clientIp, event.action, event.position, event.duration, event.title, event.occurredAt, event.clientEventId]
      );
      acceptedEventIds.push(event.clientEventId);
      if (rowCount > 0) {
        await fastify.redis.zadd("playback:events", new Date(event.occurredAt).getTime(), JSON.stringify({
          mediaId: event.mediaId, title: event.title, action: event.action,
          position: event.position, duration: event.duration, ip: clientIp, timestamp: event.occurredAt,
          clientEventId: event.clientEventId,
        }));
      }
    }
    const acceptedResumeIds = [];
    for (const resume of resumes) {
      if (!allowed.has(resume.mediaId)) continue;
      const key = `playback:resume:${clientIp}:${resume.mediaId}`;
      const remoteRaw = await fastify.redis.get(key);
      const remote = remoteRaw ? JSON.parse(remoteRaw) : null;
      if (isNewerOfflineResume(resume.updatedAt, remote?.timestamp)) {
        if (resume.duration && resume.position >= resume.duration - 3) await fastify.redis.del(key);
        else await fastify.redis.set(key, JSON.stringify({ position: resume.position, duration: resume.duration, timestamp: resume.updatedAt }), "EX", 604800);
      }
      acceptedResumeIds.push(resume.mediaId);
    }
    return { acceptedEventIds, acceptedResumeIds };
  });
}
