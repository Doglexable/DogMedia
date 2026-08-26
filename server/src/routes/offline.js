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
    SELECT c.id, c.parent_id, c.name,
           ARRAY[c.name::text]::text[] AS path_parts,
           ARRAY[COALESCE(c.sort_order, 0)]::integer[] AS order_parts
    FROM categories c
    WHERE c.parent_id IS NULL AND c.min_access_tier <= $1
    UNION ALL
    SELECT c.id, c.parent_id, c.name,
           ac.path_parts || c.name::text,
           ac.order_parts || COALESCE(c.sort_order, 0)
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
    track_order: row.track_order,
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
     ORDER BY ac.order_parts,
              ac.id,
              (m.track_order IS NULL)::int,
              COALESCE(m.track_order, 0),
              m.id`,
    params
  );
  return rows;
}

async function manifestItems(rows, dataDir) {
  const items = new Array(rows.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(8, rows.length) }, async () => {
    while (nextIndex < rows.length) {
      const index = nextIndex;
      nextIndex += 1;
      const row = rows[index];
      try {
        const stats = await stat(join(dataDir, row.file_path));
        items[index] = serializeMedia(row, stats);
      } catch {
        items[index] = null;
      }
    }
  });
  await Promise.all(workers);
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
    const acceptedEvents = events.filter((event) => allowed.has(event.mediaId));
    const acceptedEventIds = acceptedEvents.map((event) => event.clientEventId);
    let insertedIds = new Set();
    if (acceptedEvents.length > 0) {
      const { rows: inserted } = await fastify.pg.query(
        `INSERT INTO playback_events
         (media_id, client_ip, action, position, duration, title, occurred_at, client_event_id)
         SELECT event.media_id, $2::inet, event.action, event.position, event.duration,
                event.title, event.occurred_at, event.client_event_id
         FROM jsonb_to_recordset($1::jsonb) AS event(
           media_id int, action text, position int, duration int, title text,
           occurred_at timestamptz, client_event_id uuid
         )
         ON CONFLICT (client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING
         RETURNING client_event_id`,
        [JSON.stringify(acceptedEvents.map((event) => ({
          media_id: event.mediaId,
          action: event.action,
          position: event.position,
          duration: event.duration,
          title: event.title,
          occurred_at: event.occurredAt,
          client_event_id: event.clientEventId,
        }))), clientIp]
      );
      insertedIds = new Set(inserted.map((row) => String(row.client_event_id)));
    }
    const insertedEvents = acceptedEvents.filter((event) => insertedIds.has(String(event.clientEventId)));
    if (insertedEvents.length > 0) {
      const pipeline = fastify.redis.multi();
      for (const event of insertedEvents) {
        pipeline.zadd("playback:events", new Date(event.occurredAt).getTime(), JSON.stringify({
          mediaId: event.mediaId, title: event.title, action: event.action,
          position: event.position, duration: event.duration, ip: clientIp, timestamp: event.occurredAt,
          clientEventId: event.clientEventId,
        }));
      }
      await pipeline.exec();
    }

    const acceptedResumes = resumes.filter((resume) => allowed.has(resume.mediaId));
    const resumeKeys = acceptedResumes.map((resume) => `playback:resume:${clientIp}:${resume.mediaId}`);
    const remoteValues = resumeKeys.length === 0
      ? []
      : typeof fastify.redis.mget === "function"
        ? await fastify.redis.mget(resumeKeys)
        : await Promise.all(resumeKeys.map((key) => fastify.redis.get(key)));
    const resumePipeline = acceptedResumes.length > 0 ? fastify.redis.multi() : null;
    const acceptedResumeIds = [];
    for (let index = 0; index < acceptedResumes.length; index += 1) {
      const resume = acceptedResumes[index];
      const key = `playback:resume:${clientIp}:${resume.mediaId}`;
      const remoteRaw = remoteValues[index];
      const remote = remoteRaw ? JSON.parse(remoteRaw) : null;
      if (isNewerOfflineResume(resume.updatedAt, remote?.timestamp)) {
        if (resume.duration && resume.position >= resume.duration - 3) resumePipeline.del(key);
        else resumePipeline.set(key, JSON.stringify({ position: resume.position, duration: resume.duration, timestamp: resume.updatedAt }), "EX", 604800);
      }
      acceptedResumeIds.push(resume.mediaId);
    }
    if (resumePipeline) await resumePipeline.exec();
    return { acceptedEventIds, acceptedResumeIds };
  });
}
