import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { join } from "path";
import { extractMediaSubtitles, getSubtitlesForMedia } from "../subtitles.js";

const ACCESSIBLE_MEDIA_SQL = `
  WITH RECURSIVE accessible_categories AS (
    SELECT c.id, c.parent_id
    FROM categories c
    WHERE c.parent_id IS NULL
      AND c.min_access_tier <= $1
    UNION ALL
    SELECT c.id, c.parent_id
    FROM categories c
    JOIN accessible_categories ac ON c.parent_id = ac.id
    WHERE c.min_access_tier <= $1
  )
  SELECT
    m.id,
    m.file_path,
    m.mime_type
  FROM media_assets m
  JOIN accessible_categories ac ON ac.id = m.category_id
  WHERE m.id = $2
`;

async function checkMediaAccess(fastify, request, reply, mediaId) {
  const { rows } = await fastify.pg.query(ACCESSIBLE_MEDIA_SQL, [request.accessTier, mediaId]);
  if (rows.length === 0) {
    const { rowCount } = await fastify.pg.query("SELECT 1 FROM media_assets WHERE id = $1", [mediaId]);
    if (rowCount === 0) {
      reply.code(404).send({ error: "Media not found" });
    } else {
      reply.code(403).send({ error: "Access denied" });
    }
    return null;
  }
  return rows[0];
}

export default async function subtitlesRoutes(fastify) {
  const dataDir = process.env.DATA_DIR || join(process.cwd(), "data");

  // List all subtitle tracks for media
  fastify.get("/media/:id/subtitles", async (request, reply) => {
    const media = await checkMediaAccess(fastify, request, reply, request.params.id);
    if (!media) return;

    let list = await getSubtitlesForMedia(fastify.pg, media.id);
    if (list.length === 0 && media.mime_type?.startsWith("video/")) {
      // Auto-extract subtitles on demand if not extracted yet
      try {
        list = await extractMediaSubtitles({
          dataDir,
          mediaId: media.id,
          filePath: media.file_path,
          pg: fastify.pg,
          log: request.log,
        });
      } catch (err) {
        request.log.warn({ err, mediaId: media.id }, "error during on-demand subtitle extraction");
      }
    }

    return list;
  });

  // Serve WebVTT subtitle stream
  fastify.get("/media/:id/subtitles/:subtitleId/vtt", async (request, reply) => {
    const media = await checkMediaAccess(fastify, request, reply, request.params.id);
    if (!media) return;

    const { rows } = await fastify.pg.query(
      "SELECT * FROM media_subtitles WHERE id = $1 AND media_id = $2",
      [request.params.subtitleId, media.id]
    );

    if (rows.length === 0 || !rows[0].vtt_path) {
      return reply.code(404).send({ error: "Subtitle not found" });
    }

    const filePath = join(dataDir, rows[0].vtt_path);
    try {
      await stat(filePath);
    } catch {
      return reply.code(404).send({ error: "Subtitle file missing from storage" });
    }

    reply.header("Content-Type", "text/vtt; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(createReadStream(filePath));
  });

  // Serve raw ASS subtitle stream for full ASS rendering
  fastify.get("/media/:id/subtitles/:subtitleId/ass", async (request, reply) => {
    const media = await checkMediaAccess(fastify, request, reply, request.params.id);
    if (!media) return;

    const { rows } = await fastify.pg.query(
      "SELECT * FROM media_subtitles WHERE id = $1 AND media_id = $2",
      [request.params.subtitleId, media.id]
    );

    if (rows.length === 0 || !rows[0].ass_path) {
      return reply.code(404).send({ error: "ASS subtitle not available for this track" });
    }

    const filePath = join(dataDir, rows[0].ass_path);
    try {
      await stat(filePath);
    } catch {
      return reply.code(404).send({ error: "ASS subtitle file missing from storage" });
    }

    reply.header("Content-Type", "text/x-ssa; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(createReadStream(filePath));
  });
}
