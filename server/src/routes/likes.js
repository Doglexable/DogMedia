import { createHash, randomBytes } from "crypto";
import { ACCESSIBLE_CATEGORY_IDS_SQL } from "../category-access.js";


function ownerId(request) {
  return request.user.id;
}

function normalizeMediaId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export default async function (fastify) {
  fastify.get("/", async (request) => {
    const { rows } = await fastify.pg.query(
      `${ACCESSIBLE_CATEGORY_IDS_SQL}
       SELECT m.*, c.name AS category_name, l.liked_at
       FROM liked_music l
       JOIN media_assets m ON m.id = l.media_id
       JOIN accessible_categories ac ON ac.id = m.category_id
       JOIN categories c ON c.id = m.category_id
       WHERE l.user_id = $2
         AND m.mime_type LIKE 'audio/%'
       ORDER BY l.liked_at DESC`,
      [request.accessTier, ownerId(request)]
    );
    return rows;
  });

  fastify.put("/:mediaId", async (request, reply) => {
    const mediaId = normalizeMediaId(request.params.mediaId);
    if (mediaId === null) return reply.code(400).send({ error: "Invalid media ID" });

    const { rows } = await fastify.pg.query(
      `${ACCESSIBLE_CATEGORY_IDS_SQL}
       SELECT m.id, m.mime_type
       FROM media_assets m
       JOIN accessible_categories ac ON ac.id = m.category_id
       WHERE m.id = $2`,
      [request.accessTier, mediaId]
    );
    if (rows.length === 0) return reply.code(404).send({ error: "Audio not found" });
    if (!rows[0].mime_type?.startsWith("audio/")) {
      return reply.code(400).send({ error: "Only audio can be liked" });
    }

    const result = await fastify.pg.query(
      `INSERT INTO liked_music (user_id, media_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, media_id) DO UPDATE SET liked_at = liked_music.liked_at
       RETURNING media_id, liked_at`,
      [ownerId(request), mediaId]
    );
    return result.rows[0];
  });

  fastify.delete("/:mediaId", async (request, reply) => {
    const mediaId = normalizeMediaId(request.params.mediaId);
    if (mediaId === null) return reply.code(400).send({ error: "Invalid media ID" });
    await fastify.pg.query(
      "DELETE FROM liked_music WHERE user_id = $1 AND media_id = $2",
      [ownerId(request), mediaId]
    );
    return { ok: true };
  });

  fastify.get("/share", async (request) => {
    const { rowCount } = await fastify.pg.query(
      "SELECT 1 FROM liked_music_shares WHERE user_id = $1",
      [ownerId(request)]
    );
    return { enabled: rowCount > 0 };
  });

  fastify.post("/share", async (request) => {
    const token = randomBytes(32).toString("base64url");
    await fastify.pg.query(
      `INSERT INTO liked_music_shares (user_id, token_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
       SET token_hash = EXCLUDED.token_hash, created_at = NOW()`,
      [ownerId(request), hashToken(token)]
    );
    return { enabled: true, token };
  });

  fastify.delete("/share", async (request) => {
    await fastify.pg.query(
      "DELETE FROM liked_music_shares WHERE user_id = $1",
      [ownerId(request)]
    );
    return { enabled: false };
  });
}
