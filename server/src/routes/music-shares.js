import { createHash, randomBytes } from "crypto";
import { enqueueMusicReel } from "../music-reel-queue.js";

const SHARE_MIN_TIER = Math.max(0, Number.parseInt(process.env.MEDIA_SHARE_MIN_TIER || "100", 10) || 100);
const MAX_TRACKS = 10;
const REEL_RETENTION_DAYS = 1;

function ownerIp(request) {
  return request.clientIp || request.ip;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeMediaIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TRACKS) return null;
  const ids = value.map((id) => Number.parseInt(id, 10));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) return null;
  return ids;
}

function normalizeClipStarts(value, mediaIds) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length !== mediaIds.length) return undefined;
  const starts = value.map(Number);
  if (starts.some((start) => !Number.isFinite(start) || start < 0)) return undefined;
  return starts;
}

export function boundedClipStart(start, duration) {
  const normalizedStart = Math.max(0, Number(start) || 0);
  const normalizedDuration = Number(duration);
  if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) return normalizedStart;
  return Math.min(normalizedStart, Math.max(0, normalizedDuration - 10));
}

export function lyricLeadInStart(segments, leadInSeconds = 2) {
  if (!Array.isArray(segments)) return 0;
  const starts = segments
    .map((segment) => Number(segment?.start))
    .filter((start) => Number.isFinite(start) && start >= 0);
  if (!starts.length) return 0;
  return Math.max(0, Math.min(...starts) - Math.max(0, Number(leadInSeconds) || 0));
}

function serializeReel(row) {
  if (!row) return { enabled: false };
  return {
    enabled: true,
    reelId: Number(row.id),
    status: row.status,
    progress: Number(row.progress || 0),
    trackCount: Number(row.track_count || 0),
    mediaIds: Array.isArray(row.media_ids) ? row.media_ids.map(Number) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    error: row.status === "failed" ? row.last_error || "The video could not be prepared" : null,
  };
}

const CURRENT_REEL_SQL = `
  SELECT r.*, COUNT(i.reel_id)::int AS track_count,
         COALESCE(array_agg(i.media_id ORDER BY i.position) FILTER (WHERE i.media_id IS NOT NULL), '{}') AS media_ids
  FROM music_share_reels r
  LEFT JOIN music_share_reel_items i ON i.reel_id = r.id
  WHERE r.owner_ip = $1::inet AND r.revoked_at IS NULL AND r.expires_at > NOW()
    AND r.created_at > NOW() - INTERVAL '1 day'
  GROUP BY r.id
  ORDER BY r.created_at DESC LIMIT 1
`;

const SELECTED_LIKES_SQL = `
  WITH RECURSIVE accessible_categories AS (
    SELECT id FROM categories WHERE parent_id IS NULL AND min_access_tier <= $1
    UNION ALL
    SELECT c.id FROM categories c
    JOIN accessible_categories ac ON c.parent_id = ac.id
    WHERE c.min_access_tier <= $1
  ), requested AS (
    SELECT media_id, position
    FROM unnest($3::int[]) WITH ORDINALITY AS picked(media_id, position)
  )
  SELECT m.id, m.title, m.artists, m.source_version, m.duration, requested.position,
         ml.segments AS lyrics_segments
  FROM requested
  LEFT JOIN liked_music l ON l.media_id = requested.media_id AND l.client_ip = $2::inet
  JOIN media_assets m ON m.id = requested.media_id AND m.mime_type LIKE 'audio/%'
  JOIN accessible_categories ac ON ac.id = m.category_id
  LEFT JOIN media_lyrics ml ON ml.media_id = m.id
  WHERE cardinality($3::int[]) = 1 OR l.media_id IS NOT NULL
  ORDER BY requested.position
`;

export default async function (fastify) {
  fastify.get("/current", async (request) => {
    const { rows } = await fastify.pg.query(CURRENT_REEL_SQL, [ownerIp(request)]);
    return serializeReel(rows[0]);
  });

  fastify.post("/", async (request, reply) => {
    if (Number(request.accessTier) < SHARE_MIN_TIER) {
      return reply.code(403).send({ error: "Insufficient tier to create a music reel" });
    }
    const mediaIds = normalizeMediaIds(request.body?.mediaIds);
    if (!mediaIds) return reply.code(400).send({ error: "Choose between 1 and 10 unique favorite tracks" });
    const clipStarts = normalizeClipStarts(request.body?.clipStarts, mediaIds);
    if (clipStarts === undefined) {
      return reply.code(400).send({ error: "clipStarts must contain one non-negative time for each track" });
    }
    const { rows: selected } = await fastify.pg.query(SELECTED_LIKES_SQL, [request.accessTier, ownerIp(request), mediaIds]);
    if (selected.length !== mediaIds.length) {
      return reply.code(400).send({
        error: mediaIds.length === 1
          ? "The selected track is not accessible"
          : "Every multi-track selection must be an accessible favorite",
      });
    }

    const token = randomBytes(32).toString("base64url");
    const client = await fastify.pg.connect();
    let reel;
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE music_share_reels SET revoked_at = NOW(), updated_at = NOW() WHERE owner_ip = $1::inet AND revoked_at IS NULL",
        [ownerIp(request)]
      );
      const created = await client.query(
        `INSERT INTO music_share_reels (owner_ip, token_hash, expires_at)
         VALUES ($1::inet, $2, NOW() + ($3 * INTERVAL '1 day'))
         RETURNING *`,
        [ownerIp(request), hashToken(token), REEL_RETENTION_DAYS]
      );
      reel = created.rows[0];
      const reelItems = [];
      for (const item of selected) {
        const requestedClipStart = clipStarts?.[Number(item.position) - 1];
        const clipStart = boundedClipStart(
          requestedClipStart == null ? lyricLeadInStart(item.lyrics_segments) : requestedClipStart,
          item.duration
        );
        reelItems.push([reel.id, Number(item.position), item.id, item.source_version, clipStart, item.title, item.artists]);
      }

      if (reelItems.length > 0) {
        const valuePlaceholders = reelItems.map((_, i) => {
          const offset = i * 7;
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
        }).join(", ");
        await client.query(
          `INSERT INTO music_share_reel_items
             (reel_id, position, media_id, source_version, clip_start, title, artists)
           VALUES ${valuePlaceholders}`,
          reelItems.flat()
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    try {
      await enqueueMusicReel(fastify.redis, reel.id);
    } catch (error) {
      await fastify.pg.query(
        "UPDATE music_share_reels SET status = 'failed', last_error = $2, updated_at = NOW() WHERE id = $1",
        [reel.id, "The render worker could not be reached"]
      );
      throw error;
    }

    return reply.code(202).send({
      ...serializeReel({ ...reel, track_count: selected.length, media_ids: mediaIds }),
      token,
      sharePath: `/shared/music#${token}`,
      clipSeconds: 10,
      aspectRatio: "4:3",
    });
  });

  fastify.post("/current/link", async (request, reply) => {
    if (Number(request.accessTier) < SHARE_MIN_TIER) {
      return reply.code(403).send({ error: "Insufficient tier to share a music reel" });
    }
    const token = randomBytes(32).toString("base64url");
    const { rows } = await fastify.pg.query(
      `WITH updated AS (
         UPDATE music_share_reels
         SET token_hash = $2, updated_at = NOW()
         WHERE owner_ip = $1::inet AND revoked_at IS NULL AND expires_at > NOW()
           AND created_at > NOW() - INTERVAL '1 day'
           AND status = 'ready'
         RETURNING *
       )
       SELECT updated.*, COALESCE(items.track_count, 0) AS track_count,
              COALESCE(items.media_ids, '{}') AS media_ids
       FROM updated
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS track_count,
                array_agg(i.media_id ORDER BY i.position) AS media_ids
         FROM music_share_reel_items i
         WHERE i.reel_id = updated.id
       ) items ON TRUE`,
      [ownerIp(request), hashToken(token)]
    );
    if (!rows[0]) return reply.code(409).send({ error: "The reel is not ready to share" });
    return {
      ...serializeReel(rows[0]),
      token,
      sharePath: `/shared/music#${token}`,
    };
  });

  fastify.delete("/current", async (request) => {
    await fastify.pg.query(
      "UPDATE music_share_reels SET revoked_at = NOW(), updated_at = NOW() WHERE owner_ip = $1::inet AND revoked_at IS NULL",
      [ownerIp(request)]
    );
    return { enabled: false };
  });
}
