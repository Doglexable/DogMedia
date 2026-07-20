import { createHash } from "crypto";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export default async function (fastify) {
  fastify.get("/liked-music/:token", async (request, reply) => {
    reply.header("Cache-Control", "no-store, private, max-age=0");
    const token = String(request.params.token || "");
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      return reply.code(404).send({ error: "Shared list not found" });
    }

    const { rows: shareRows } = await fastify.pg.query(
      `SELECT s.client_ip, access.access_tier
       FROM liked_music_shares s
       JOIN LATERAL (
         SELECT w.access_tier
         FROM ip_whitelist w
         WHERE s.client_ip <<= w.cidr_range
         ORDER BY masklen(w.cidr_range) DESC
         LIMIT 1
       ) access ON TRUE
       WHERE s.token_hash = $1`,
      [hashToken(token)]
    );
    if (shareRows.length === 0) {
      return reply.code(404).send({ error: "Shared list not found" });
    }

    const share = shareRows[0];
    const { rows } = await fastify.pg.query(
      `WITH RECURSIVE accessible_categories AS (
         SELECT id FROM categories
         WHERE parent_id IS NULL AND min_access_tier <= $1
         UNION ALL
         SELECT c.id FROM categories c
         JOIN accessible_categories ac ON c.parent_id = ac.id
         WHERE c.min_access_tier <= $1
       )
       SELECT m.title
       FROM liked_music l
       JOIN media_assets m ON m.id = l.media_id
       JOIN accessible_categories ac ON ac.id = m.category_id
       WHERE l.client_ip = $2::inet
         AND m.mime_type LIKE 'audio/%'
       ORDER BY l.liked_at DESC`,
      [share.access_tier, share.client_ip]
    );
    return { titles: rows.map((row) => row.title) };
  });
}
