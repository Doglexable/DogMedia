import { LyricsValidationError, normalizeWhisperLyrics } from "../lyrics.js";

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
    m.id AS media_id,
    ml.language,
    ml.segments,
    ml.updated_at
  FROM media_assets m
  JOIN accessible_categories ac ON ac.id = m.category_id
  LEFT JOIN media_lyrics ml ON ml.media_id = m.id
  WHERE m.id = $2
`;

function serializeLyrics(row) {
  return {
    mediaId: Number(row.media_id),
    language: row.language,
    segments: row.segments,
    updatedAt: row.updated_at,
  };
}

async function sendMissingMedia(fastify, reply, mediaId) {
  const { rowCount } = await fastify.pg.query("SELECT 1 FROM media_assets WHERE id = $1", [mediaId]);
  if (rowCount === 0) return reply.code(404).send({ error: "Media not found" });
  return reply.code(403).send({ error: "Access denied" });
}

export default async function lyricsRoutes(fastify) {
  fastify.get("/media/:id/lyrics", async (request, reply) => {
    const { rows } = await fastify.pg.query(ACCESSIBLE_MEDIA_SQL, [request.accessTier, request.params.id]);
    if (rows.length === 0) return sendMissingMedia(fastify, reply, request.params.id);
    if (!rows[0].segments) return reply.code(404).send({ error: "Lyrics not found" });
    return serializeLyrics(rows[0]);
  });

  fastify.put("/media/:id/lyrics", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    let lyrics;
    try {
      lyrics = normalizeWhisperLyrics(request.body);
    } catch (error) {
      if (error instanceof LyricsValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }

    const { rowCount } = await fastify.pg.query("SELECT 1 FROM media_assets WHERE id = $1", [request.params.id]);
    if (rowCount === 0) return reply.code(404).send({ error: "Media not found" });

    const { rows } = await fastify.pg.query(
      `INSERT INTO media_lyrics (media_id, language, segments)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (media_id) DO UPDATE
       SET language = EXCLUDED.language,
           segments = EXCLUDED.segments,
           updated_at = NOW()
       RETURNING media_id, language, segments, updated_at`,
      [request.params.id, lyrics.language, JSON.stringify(lyrics.segments)]
    );

    return serializeLyrics(rows[0]);
  });

  fastify.delete("/media/:id/lyrics", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const { rowCount } = await fastify.pg.query("DELETE FROM media_lyrics WHERE media_id = $1", [request.params.id]);
    if (rowCount === 0) return reply.code(404).send({ error: "Lyrics not found" });
    return reply.code(204).send();
  });
}

