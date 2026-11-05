import { createHash, randomBytes } from "crypto";
import { ACCESSIBLE_CATEGORY_IDS_SQL } from "../category-access.js";


function ownerId(request) {
  return request.user.id;
}

function normalizeMediaId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCategoryId(value) {
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

  fastify.get("/category-status", async (request) => {
    const { rows } = await fastify.pg.query(
      `WITH RECURSIVE accessible_categories AS (
         SELECT id, parent_id FROM categories WHERE min_access_tier <= $1
       ), descendants AS (
         SELECT id AS root_id, id AS category_id FROM accessible_categories
         UNION ALL
         SELECT d.root_id, c.id
         FROM descendants d
         JOIN accessible_categories c ON c.parent_id = d.category_id
       )
       SELECT d.root_id AS category_id,
              COUNT(m.id)::int AS total_audio_count,
              COUNT(l.media_id)::int AS liked_audio_count
       FROM descendants d
       LEFT JOIN media_assets m ON m.category_id = d.category_id AND m.mime_type LIKE 'audio/%'
       LEFT JOIN liked_music l ON l.media_id = m.id AND l.user_id = $2
       GROUP BY d.root_id`,
      [request.accessTier, ownerId(request)]
    );
    return rows.map((row) => {
      const totalAudioCount = Number(row.total_audio_count) || 0;
      const likedAudioCount = Number(row.liked_audio_count) || 0;
      return {
        categoryId: Number(row.category_id),
        totalAudioCount,
        likedAudioCount,
        fullyLiked: totalAudioCount > 0 && likedAudioCount === totalAudioCount,
      };
    });
  });

  // ── Favorite an entire category and its child subfolders ──
  // Single query execution to prevent N+1 query problem
  const likeCategoryHandler = async (request, reply) => {
    const categoryId = normalizeCategoryId(request.params.categoryId);
    if (categoryId === null) return reply.code(400).send({ error: "Invalid category ID" });

    const check = await fastify.pg.query(
      "SELECT id, name FROM categories WHERE id = $1 AND min_access_tier <= $2",
      [categoryId, request.accessTier]
    );
    if (check.rowCount === 0) {
      return reply.code(404).send({ error: "Category not found" });
    }
    const categoryName = check.rows[0].name;

    const { rows } = await fastify.pg.query(
      `WITH RECURSIVE folder_tree AS (
         SELECT c.id
         FROM categories c
         WHERE c.id = $1 AND c.min_access_tier <= $2
         UNION ALL
         SELECT c.id
         FROM categories c
         JOIN folder_tree ft ON c.parent_id = ft.id
         WHERE c.min_access_tier <= $2
       ), matching_media AS (
         SELECT m.id
         FROM media_assets m
         JOIN folder_tree ft ON m.category_id = ft.id
         WHERE m.mime_type LIKE 'audio/%'
       ), inserted AS (
         INSERT INTO liked_music (user_id, media_id)
         SELECT $3, mm.id
         FROM matching_media mm
         ON CONFLICT (user_id, media_id) DO NOTHING
         RETURNING media_id
       )
       SELECT
         (SELECT COUNT(*)::int FROM matching_media) AS total_count,
         (SELECT COUNT(*)::int FROM inserted) AS added_count,
         COALESCE((SELECT array_agg(media_id) FROM inserted), ARRAY[]::integer[]) AS added_ids`,
      [categoryId, request.accessTier, ownerId(request)]
    );

    const result = rows[0] || { total_count: 0, added_count: 0, added_ids: [] };
    return {
      ok: true,
      categoryId,
      categoryName,
      totalCount: result.total_count,
      addedCount: result.added_count,
      addedIds: result.added_ids || [],
    };
  };

  const unlikeCategoryHandler = async (request, reply) => {
    const categoryId = normalizeCategoryId(request.params.categoryId);
    if (categoryId === null) return reply.code(400).send({ error: "Invalid category ID" });

    const check = await fastify.pg.query(
      "SELECT id, name FROM categories WHERE id = $1 AND min_access_tier <= $2",
      [categoryId, request.accessTier]
    );
    if (check.rowCount === 0) {
      return reply.code(404).send({ error: "Category not found" });
    }
    const categoryName = check.rows[0].name;

    const { rows } = await fastify.pg.query(
      `WITH RECURSIVE folder_tree AS (
         SELECT c.id
         FROM categories c
         WHERE c.id = $1 AND c.min_access_tier <= $2
         UNION ALL
         SELECT c.id
         FROM categories c
         JOIN folder_tree ft ON c.parent_id = ft.id
         WHERE c.min_access_tier <= $2
       ), deleted AS (
         DELETE FROM liked_music
         WHERE user_id = $3
           AND media_id IN (
             SELECT m.id
             FROM media_assets m
             JOIN folder_tree ft ON m.category_id = ft.id
             WHERE m.mime_type LIKE 'audio/%'
           )
         RETURNING media_id
       )
       SELECT
         (SELECT COUNT(*)::int FROM deleted) AS removed_count,
         COALESCE((SELECT array_agg(media_id) FROM deleted), ARRAY[]::integer[]) AS removed_ids`,
      [categoryId, request.accessTier, ownerId(request)]
    );

    const result = rows[0] || { removed_count: 0, removed_ids: [] };
    return {
      ok: true,
      categoryId,
      categoryName,
      removedCount: result.removed_count,
      removedIds: result.removed_ids || [],
    };
  };

  fastify.put("/category/:categoryId", likeCategoryHandler);
  fastify.put("/folder/:categoryId", likeCategoryHandler);
  fastify.post("/category/:categoryId", likeCategoryHandler);
  fastify.post("/folder/:categoryId", likeCategoryHandler);
  fastify.delete("/category/:categoryId", unlikeCategoryHandler);
  fastify.delete("/folder/:categoryId", unlikeCategoryHandler);

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
