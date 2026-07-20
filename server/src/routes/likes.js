import { createHash, randomBytes } from "crypto";

const ACCESSIBLE_MEDIA_SQL = `
  WITH RECURSIVE accessible_categories AS (
    SELECT id FROM categories
    WHERE parent_id IS NULL AND min_access_tier <= $1
    UNION ALL
    SELECT c.id FROM categories c
    JOIN accessible_categories ac ON c.parent_id = ac.id
    WHERE c.min_access_tier <= $1
  )
`;

function ownerIp(request) {
  return request.clientIp || request.ip;
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
      `${ACCESSIBLE_MEDIA_SQL}
       SELECT m.*, c.name AS category_name, l.liked_at
       FROM liked_music l
       JOIN media_assets m ON m.id = l.media_id
       JOIN accessible_categories ac ON ac.id = m.category_id
       JOIN categories c ON c.id = m.category_id
       WHERE l.client_ip = $2::inet
         AND m.mime_type LIKE 'audio/%'
       ORDER BY l.liked_at DESC`,
      [request.accessTier, ownerIp(request)]
    );
    return rows;
  });

  fastify.put("/:mediaId", async (request, reply) => {
    const mediaId = normalizeMediaId(request.params.mediaId);
    if (mediaId === null) return reply.code(400).send({ error: "Invalid media ID" });

    const { rows } = await fastify.pg.query(
      `${ACCESSIBLE_MEDIA_SQL}
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
      `INSERT INTO liked_music (client_ip, media_id)
       VALUES ($1::inet, $2)
       ON CONFLICT (client_ip, media_id) DO UPDATE SET liked_at = liked_music.liked_at
       RETURNING media_id, liked_at`,
      [ownerIp(request), mediaId]
    );
    return result.rows[0];
  });

  fastify.delete("/:mediaId", async (request, reply) => {
    const mediaId = normalizeMediaId(request.params.mediaId);
    if (mediaId === null) return reply.code(400).send({ error: "Invalid media ID" });
    await fastify.pg.query(
      "DELETE FROM liked_music WHERE client_ip = $1::inet AND media_id = $2",
      [ownerIp(request), mediaId]
    );
    return { ok: true };
  });

  fastify.get("/share", async (request) => {
    const { rowCount } = await fastify.pg.query(
      "SELECT 1 FROM liked_music_shares WHERE client_ip = $1::inet",
      [ownerIp(request)]
    );
    return { enabled: rowCount > 0 };
  });

  fastify.post("/share", async (request) => {
    const token = randomBytes(32).toString("base64url");
    await fastify.pg.query(
      `INSERT INTO liked_music_shares (client_ip, token_hash)
       VALUES ($1::inet, $2)
       ON CONFLICT (client_ip) DO UPDATE
       SET token_hash = EXCLUDED.token_hash, created_at = NOW()`,
      [ownerIp(request), hashToken(token)]
    );
    return { enabled: true, token };
  });

  fastify.delete("/share", async (request) => {
    await fastify.pg.query(
      "DELETE FROM liked_music_shares WHERE client_ip = $1::inet",
      [ownerIp(request)]
    );
    return { enabled: false };
  });
}
