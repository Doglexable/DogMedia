import { createWriteStream } from "fs";
import { mkdir, rm, stat, unlink } from "fs/promises";
import { join } from "path";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { normalizeCategoryCover, sendCoverFile } from "../category-cover.js";

const DATA_DIR = process.env.DATA_DIR || "data";

const CATEGORY_TREE_SQL = `
  WITH RECURSIVE category_tree AS (
    SELECT
      c.id,
      c.name,
      c.description,
      c.min_access_tier,
      c.parent_id,
      c.sort_order,
      c.cover_path,
      c.created_at,
      ARRAY[c.name::text]::text[] AS path_parts,
      ARRAY[c.sort_order]::integer[] AS order_parts,
      0 AS depth
    FROM categories c
    WHERE c.parent_id IS NULL
      AND c.min_access_tier <= $1
    UNION ALL
    SELECT
      c.id,
      c.name,
      c.description,
      c.min_access_tier,
      c.parent_id,
      c.sort_order,
      c.cover_path,
      c.created_at,
      ct.path_parts || c.name::text,
      ct.order_parts || c.sort_order,
      ct.depth + 1
    FROM categories c
    JOIN category_tree ct ON c.parent_id = ct.id
    WHERE c.min_access_tier <= $1
  )
`;

function normalizeNullableInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function categoryExists(fastify, id) {
  const { rowCount } = await fastify.pg.query("SELECT 1 FROM categories WHERE id = $1", [id]);
  return rowCount > 0;
}

async function getCategory(fastify, id) {
  const { rows } = await fastify.pg.query(
    "SELECT id, parent_id, min_access_tier, sort_order, cover_path FROM categories WHERE id = $1",
    [id]
  );
  return rows[0] || null;
}

async function getParentTier(fastify, id) {
  const { rows } = await fastify.pg.query(
    "SELECT min_access_tier FROM categories WHERE id = $1",
    [id]
  );
  return rows[0]?.min_access_tier ?? null;
}

async function categoryHasChildren(fastify, id) {
  const { rowCount } = await fastify.pg.query(
    "SELECT 1 FROM categories WHERE parent_id = $1 LIMIT 1",
    [id]
  );
  return rowCount > 0;
}

async function categoryHasDescendant(fastify, id, descendantId) {
  const { rowCount } = await fastify.pg.query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM categories WHERE parent_id = $1
       UNION ALL
       SELECT c.id FROM categories c
       JOIN descendants d ON c.parent_id = d.id
     )
     SELECT 1 FROM descendants WHERE id = $2 LIMIT 1`,
    [id, descendantId]
  );
  return rowCount > 0;
}

async function propagateTierToDescendants(fastify, id, tier) {
  await fastify.pg.query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM categories WHERE parent_id = $1
       UNION ALL
       SELECT c.id FROM categories c
       JOIN descendants d ON c.parent_id = d.id
     )
     UPDATE categories
     SET min_access_tier = $2
     WHERE id IN (SELECT id FROM descendants)`,
    [id, tier]
  );
}

export default async function (fastify, options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  fastify.get("/", async (request) => {
    const { rows } = await fastify.pg.query(
      `${CATEGORY_TREE_SQL}
       SELECT
         id,
         name,
         description,
         min_access_tier,
         parent_id,
         sort_order,
         cover_path,
         created_at,
         depth,
         (SELECT COUNT(*)::int FROM categories child WHERE child.parent_id = category_tree.id) AS child_count,
         (SELECT COUNT(*)::int FROM media_assets media WHERE media.category_id = category_tree.id) AS media_count,
         array_to_string(path_parts, ' / ') AS path
       FROM category_tree
       ORDER BY order_parts`,
      [request.accessTier]
    );
    return rows;
  });

  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `${CATEGORY_TREE_SQL}
       SELECT
         id,
         name,
         description,
         min_access_tier,
         parent_id,
         sort_order,
         cover_path,
         created_at,
         depth,
         (SELECT COUNT(*)::int FROM categories child WHERE child.parent_id = category_tree.id) AS child_count,
         (SELECT COUNT(*)::int FROM media_assets media WHERE media.category_id = category_tree.id) AS media_count,
         array_to_string(path_parts, ' / ') AS path
       FROM category_tree
       WHERE id = $2`,
      [request.accessTier, id]
    );

    if (rows.length > 0) return rows[0];

    const exists = await categoryExists(fastify, id);
    if (!exists) return reply.code(404).send({ error: "Not found" });
    return reply.code(403).send({ error: "Access denied" });
  });

  fastify.post("/", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const { name, description, min_access_tier, parent_id } = request.body;
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedParentId = normalizeNullableInt(parent_id);
    let effectiveTier = min_access_tier ?? 0;

    if (!normalizedName) {
      return reply.code(400).send({ error: "Category name is required" });
    }

    if (normalizedParentId !== null) {
      const parentTier = await getParentTier(fastify, normalizedParentId);
      if (parentTier === null) {
        return reply.code(400).send({ error: "Parent category not found" });
      }
      effectiveTier = parentTier;
    }

    const { rows } = await fastify.pg.query(
      `INSERT INTO categories (name, description, min_access_tier, parent_id, sort_order)
       VALUES (
         $1, $2, $3, $4,
         (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM categories WHERE parent_id IS NOT DISTINCT FROM $4)
       )
       RETURNING *`,
      [normalizedName, description ?? null, effectiveTier, normalizedParentId]
    );
    return reply.code(201).send(rows[0]);
  });

  fastify.get("/:id/thumbnail", async (request, reply) => {
    const { rows } = await fastify.pg.query(
      `${CATEGORY_TREE_SQL}
       SELECT id, cover_path FROM category_tree WHERE id = $2`,
      [request.accessTier, request.params.id]
    );
    if (!rows.length) {
      const exists = await categoryExists(fastify, request.params.id);
      return exists ? reply.code(403).send({ error: "Access denied" }) : reply.code(404).send({ error: "Not found" });
    }
    if (!rows[0].cover_path) return reply.code(404).send({ error: "No thumbnail available" });
    const filePath = join(dataDir, rows[0].cover_path);
    try {
      return sendCoverFile({ request, reply, filePath, stats: await stat(filePath) });
    } catch {
      return reply.code(404).send({ error: "No thumbnail available" });
    }
  });

  fastify.put("/:id/thumbnail", async (request, reply) => {
    if (request.accessTier < 100) return reply.code(403).send({ error: "Insufficient tier" });
    const category = await getCategory(fastify, request.params.id);
    if (!category) return reply.code(404).send({ error: "Not found" });
    let upload = null;
    for await (const part of request.parts({ limits: { fileSize: 20 * 1024 * 1024 } })) {
      if (part.type === "file" && (part.fieldname === "thumbnail" || part.fieldname === "file")) {
        const tempDir = join(dataDir, "tmp", "covers");
        await mkdir(tempDir, { recursive: true });
        const tempPath = join(tempDir, randomUUID());
        await pipeline(part.file, createWriteStream(tempPath));
        if (upload) await unlink(upload).catch(() => {});
        upload = tempPath;
      } else if (part.type === "file") part.file.resume();
    }
    if (!upload) return reply.code(400).send({ error: "Thumbnail file required" });
    let coverPath = null;
    try {
      coverPath = await normalizeCategoryCover({ categoryId: request.params.id, dataDir, inputPath: upload });
      const { rows } = await fastify.pg.query(
        "UPDATE categories SET cover_path = $1 WHERE id = $2 RETURNING *",
        [coverPath, request.params.id]
      );
      if (category.cover_path && category.cover_path !== coverPath) {
        await unlink(join(dataDir, category.cover_path)).catch(() => {});
      }
      return rows[0];
    } catch (error) {
      if (coverPath) await unlink(join(dataDir, coverPath)).catch(() => {});
      request.log.warn({ err: error }, "category cover normalization failed");
      return reply.code(400).send({ error: "Thumbnail could not be converted to WebP" });
    } finally {
      await unlink(upload).catch(() => {});
    }
  });

  fastify.delete("/:id/thumbnail", async (request, reply) => {
    if (request.accessTier < 100) return reply.code(403).send({ error: "Insufficient tier" });
    const { rows } = await fastify.pg.query(
      `SELECT c.id, c.parent_id, c.cover_path,
              EXISTS (SELECT 1 FROM media_assets m WHERE m.category_id = c.id) AS has_media
       FROM categories c WHERE c.id = $1`,
      [request.params.id]
    );
    const category = rows[0];
    if (!category) return reply.code(404).send({ error: "Not found" });
    if (category.parent_id !== null && category.has_media) {
      return reply.code(409).send({ error: "A non-root category containing media must have a cover" });
    }
    if (category.cover_path) await unlink(join(dataDir, category.cover_path)).catch(() => {});
    await fastify.pg.query("UPDATE categories SET cover_path = NULL WHERE id = $1", [request.params.id]);
    return reply.code(204).send();
  });

  fastify.put("/:id", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const { id } = request.params;
    const { name, description, min_access_tier, parent_id } = request.body;
    const normalizedName = typeof name === "string" ? name.trim() : null;
    const hasParentId = Object.hasOwn(request.body, "parent_id");
    const normalizedParentId = normalizeNullableInt(parent_id);
    const existing = await getCategory(fastify, id);

    if (!existing) return reply.code(404).send({ error: "Not found" });

    if (normalizedParentId !== null && normalizedParentId === Number.parseInt(id, 10)) {
      return reply.code(400).send({ error: "A category cannot be its own parent" });
    }

    if (normalizedParentId !== null && await categoryHasDescendant(fastify, id, normalizedParentId)) {
      return reply.code(400).send({ error: "A category cannot be moved under its own child" });
    }

    const effectiveParentId = hasParentId ? normalizedParentId : existing.parent_id;
    let effectiveTier = min_access_tier ?? existing.min_access_tier;
    let effectiveSortOrder = existing.sort_order;

    if (effectiveParentId !== null) {
      const parentTier = await getParentTier(fastify, effectiveParentId);
      if (parentTier === null) {
        return reply.code(400).send({ error: "Parent category not found" });
      }
      effectiveTier = parentTier;
    }

    if (hasParentId && effectiveParentId !== existing.parent_id) {
      const { rows: orderRows } = await fastify.pg.query(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order FROM categories WHERE parent_id IS NOT DISTINCT FROM $1 AND id <> $2",
        [effectiveParentId, id]
      );
      effectiveSortOrder = orderRows[0].next_order;
    }

    const { rows } = await fastify.pg.query(
      "UPDATE categories SET name = COALESCE($1, name), description = COALESCE($2, description), min_access_tier = $3, parent_id = $4, sort_order = $5 WHERE id = $6 RETURNING *",
      [normalizedName, description ?? null, effectiveTier, effectiveParentId, effectiveSortOrder, id]
    );

    await propagateTierToDescendants(fastify, id, effectiveTier);

    return rows[0];
  });

  fastify.patch("/:id/move", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const categoryId = Number.parseInt(request.params.id, 10);
    const hasParentId = Object.hasOwn(request.body || {}, "parentId");
    const rawParentId = request.body?.parentId;
    const parentId = normalizeNullableInt(rawParentId);
    const requestedIndex = request.body?.index;

    if (
      !Number.isFinite(categoryId) || categoryId < 1 ||
      !hasParentId || (rawParentId !== null && (!Number.isInteger(parentId) || parentId < 1)) ||
      !Number.isInteger(requestedIndex) || requestedIndex < 0
    ) {
      return reply.code(400).send({ error: "A valid category and non-negative index are required" });
    }

    if (parentId === categoryId) {
      return reply.code(400).send({ error: "A category cannot be its own parent" });
    }

    const client = await fastify.pg.connect();
    try {
      await client.query("BEGIN");

      const { rows: existingRows } = await client.query(
        "SELECT id, parent_id, min_access_tier FROM categories WHERE id = $1 FOR UPDATE",
        [categoryId]
      );
      const existing = existingRows[0];
      if (!existing) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "Not found" });
      }

      let effectiveTier = existing.min_access_tier;
      if (parentId !== null) {
        const { rows: parentRows } = await client.query(
          "SELECT id, min_access_tier FROM categories WHERE id = $1 FOR UPDATE",
          [parentId]
        );
        if (!parentRows[0]) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Parent category not found" });
        }

        const { rowCount: descendantCount } = await client.query(
          `WITH RECURSIVE descendants AS (
             SELECT id FROM categories WHERE parent_id = $1
             UNION ALL
             SELECT c.id FROM categories c
             JOIN descendants d ON c.parent_id = d.id
           )
           SELECT 1 FROM descendants WHERE id = $2 LIMIT 1`,
          [categoryId, parentId]
        );
        if (descendantCount > 0) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "A category cannot be moved under its own child" });
        }
        effectiveTier = parentRows[0].min_access_tier;
      }

      await client.query(
        `SELECT id FROM categories
         WHERE parent_id IS NOT DISTINCT FROM $1
            OR parent_id IS NOT DISTINCT FROM $2
         FOR UPDATE`,
        [existing.parent_id, parentId]
      );

      if (existing.parent_id !== parentId) {
        const { rows: oldSiblings } = await client.query(
          `SELECT id FROM categories
           WHERE parent_id IS NOT DISTINCT FROM $1 AND id <> $2
           ORDER BY sort_order, name, id`,
          [existing.parent_id, categoryId]
        );
        for (const [index, sibling] of oldSiblings.entries()) {
          await client.query("UPDATE categories SET sort_order = $1 WHERE id = $2", [index, sibling.id]);
        }
      }

      const { rows: destinationRows } = await client.query(
        `SELECT id FROM categories
         WHERE parent_id IS NOT DISTINCT FROM $1 AND id <> $2
         ORDER BY sort_order, name, id`,
        [parentId, categoryId]
      );
      const destinationIds = destinationRows.map((row) => row.id);
      const nextIndex = Math.min(requestedIndex, destinationIds.length);
      destinationIds.splice(nextIndex, 0, categoryId);

      await client.query(
        "UPDATE categories SET parent_id = $1, min_access_tier = $2 WHERE id = $3",
        [parentId, effectiveTier, categoryId]
      );
      for (const [index, id] of destinationIds.entries()) {
        await client.query("UPDATE categories SET sort_order = $1 WHERE id = $2", [index, id]);
      }

      await client.query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM categories WHERE parent_id = $1
           UNION ALL
           SELECT c.id FROM categories c
           JOIN descendants d ON c.parent_id = d.id
         )
         UPDATE categories SET min_access_tier = $2
         WHERE id IN (SELECT id FROM descendants)`,
        [categoryId, effectiveTier]
      );

      const { rows } = await client.query(
        "SELECT id, parent_id, sort_order, min_access_tier FROM categories WHERE id = $1",
        [categoryId]
      );
      await client.query("COMMIT");
      return rows[0];
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });

  fastify.delete("/:id", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }
    const { id } = request.params;
    const exists = await categoryExists(fastify, id);
    if (!exists) return reply.code(404).send({ error: "Not found" });

    if (await categoryHasChildren(fastify, id)) {
      return reply.code(409).send({ error: "Delete child categories first" });
    }

    const { rows: categoryRows } = await fastify.pg.query("SELECT cover_path FROM categories WHERE id = $1", [id]);
    const { rowCount } = await fastify.pg.query(
      "DELETE FROM categories WHERE id = $1 RETURNING cover_path",
      [id]
    );
    if (rowCount === 0) return reply.code(404).send({ error: "Not found" });
    if (categoryRows[0]?.cover_path) await unlink(join(dataDir, categoryRows[0].cover_path)).catch(() => {});
    await rm(join(dataDir, String(id)), { recursive: true, force: true }).catch(() => {});
    return reply.code(204).send();
  });
}
