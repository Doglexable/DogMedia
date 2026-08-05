import { LyricsValidationError, normalizeWhisperLyrics, upsertUploadedLyrics } from "../lyrics.js";
import { LyricaProviderError, normalizeLyricsIdentity, resolveLyricaLyrics } from "../lyrica.js";

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
    m.title,
    m.artists,
    m.mime_type,
    ml.language,
    ml.segments,
    ml.source AS lyrics_source,
    ml.lookup_title,
    ml.lookup_artists,
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

function isCurrentLyricaRow(row, title, artists) {
  return row.lyrics_source === "lyrica"
    && normalizeLyricsIdentity(row.lookup_title) === normalizeLyricsIdentity(title)
    && normalizeLyricsIdentity(row.lookup_artists) === normalizeLyricsIdentity(artists);
}

async function persistLyricaLyrics(pg, row, lyrics, title, artists) {
  const { rows } = await pg.query(
    `INSERT INTO media_lyrics (
       media_id, language, segments, source, lookup_title, lookup_artists
     ) VALUES ($1, $2, $3::jsonb, 'lyrica', $4, $5)
     ON CONFLICT (media_id) DO UPDATE
     SET language = EXCLUDED.language,
         segments = EXCLUDED.segments,
         source = 'lyrica',
         lookup_title = EXCLUDED.lookup_title,
         lookup_artists = EXCLUDED.lookup_artists,
         updated_at = NOW()
     WHERE media_lyrics.source = 'lyrica'
     RETURNING media_id, language, segments, updated_at`,
    [row.media_id, lyrics.language, JSON.stringify(lyrics.segments), title, artists]
  );
  if (rows.length > 0) return serializeLyrics(rows[0]);

  const { rows: currentRows } = await pg.query(
    "SELECT media_id, language, segments, updated_at FROM media_lyrics WHERE media_id = $1",
    [row.media_id]
  );
  return currentRows.length > 0 ? serializeLyrics(currentRows[0]) : null;
}

export async function resolveMediaLyrics(row, options = {}) {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const artists = typeof row.artists === "string" ? row.artists.trim() : "";

  if (row.segments && row.lyrics_source !== "lyrica") return serializeLyrics(row);
  if (row.segments && isCurrentLyricaRow(row, title, artists)) return serializeLyrics(row);

  if (!row.mime_type?.startsWith("audio/") || !title || !artists) {
    if (row.lyrics_source === "lyrica") {
      await options.pg.query("DELETE FROM media_lyrics WHERE media_id = $1 AND source = 'lyrica'", [row.media_id]);
    }
    return null;
  }

  const lyrics = await resolveLyricaLyrics({
    ...options,
    artist: artists,
    song: title,
  });
  if (!lyrics) {
    if (row.lyrics_source === "lyrica") {
      await options.pg.query("DELETE FROM media_lyrics WHERE media_id = $1 AND source = 'lyrica'", [row.media_id]);
    }
    return null;
  }

  return persistLyricaLyrics(options.pg, row, lyrics, title, artists);
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

    try {
      const lyrics = await resolveMediaLyrics(rows[0], {
        pg: fastify.pg,
        redis: fastify.redis,
        log: request.log,
      });
      if (!lyrics) return reply.code(404).send({ error: "Lyrics not found" });
      return lyrics;
    } catch (error) {
      if (!(error instanceof LyricaProviderError)) throw error;

      request.log.warn({ err: error, mediaId: request.params.id }, "Lyrica lookup failed");
      if (error.kind === "rate-limit") {
        if (error.retryAfter != null) reply.header("Retry-After", error.retryAfter);
        return reply.code(503).send({ error: "Lyrics provider rate limited" });
      }
      return reply.code(502).send({ error: "Lyrics provider unavailable" });
    }
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

    const row = await upsertUploadedLyrics(fastify.pg, request.params.id, lyrics);
    return serializeLyrics(row);
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
