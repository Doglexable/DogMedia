import { createWriteStream } from "fs";
import { mkdir, readFile, rm, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { resolveMediaLyrics } from "./lyrics.js";
import {
  blurPathFromCover,
  generateBlurCover,
  normalizeCategoryCover,
  sendCoverFile,
  unlinkCoverWithBlur,
} from "../category-cover.js";

const DATA_DIR = process.env.DATA_DIR || "data";

const CATEGORY_TREE_SQL = `
  WITH RECURSIVE all_categories AS (
    SELECT
      c.id,
      c.name,
      c.description,
      c.min_access_tier,
      c.parent_id,
      c.sort_order,
      c.cover_path,
      c.created_at,
      CASE WHEN c.min_access_tier <= $1 THEN ARRAY[c.name::text] ELSE ARRAY[]::text[] END AS path_parts,
      ARRAY[c.sort_order]::integer[] AS order_parts,
      CASE WHEN c.min_access_tier <= $1 THEN 0 ELSE -1 END AS depth,
      NULL::integer AS visible_parent_id,
      CASE WHEN c.min_access_tier <= $1 THEN c.id ELSE NULL::integer END AS visible_ancestor_id
    FROM categories c
    WHERE c.parent_id IS NULL
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
      CASE WHEN c.min_access_tier <= $1 THEN ct.path_parts || c.name::text ELSE ct.path_parts END,
      ct.order_parts || c.sort_order,
      CASE WHEN c.min_access_tier <= $1 THEN ct.depth + 1 ELSE ct.depth END,
      ct.visible_ancestor_id,
      CASE WHEN c.min_access_tier <= $1 THEN c.id ELSE ct.visible_ancestor_id END
    FROM categories c
    JOIN all_categories ct ON c.parent_id = ct.id
  ), category_tree AS (
    SELECT * FROM all_categories WHERE min_access_tier <= $1
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

async function getAccessibleCategory(pg, id, accessTier) {
  const { rows } = await pg.query(
    `${CATEGORY_TREE_SQL}
     SELECT id, parent_id, min_access_tier, sort_order, cover_path
     FROM category_tree WHERE id = $2`,
    [accessTier, id]
  );
  return rows[0] || null;
}

async function sendMissingOrDeniedCategory(fastify, reply, id) {
  if (await categoryExists(fastify, id)) return reply.code(403).send({ error: "Access denied" });
  return reply.code(404).send({ error: "Not found" });
}

async function sendMissingOrDeniedParent(fastify, reply, id) {
  if (await categoryExists(fastify, id)) return reply.code(403).send({ error: "Access denied" });
  return reply.code(400).send({ error: "Parent category not found" });
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

export default async function (fastify, options = {}) {
  const dataDir = options.dataDir || DATA_DIR;
  fastify.get("/", async (request) => {
    const { rows } = await fastify.pg.query(
      `${CATEGORY_TREE_SQL}
       SELECT
         category_tree.id,
         category_tree.name,
         category_tree.description,
         category_tree.min_access_tier,
         category_tree.visible_parent_id AS parent_id,
         CASE WHEN $1 >= 100 THEN category_tree.parent_id ELSE NULL END AS stored_parent_id,
         category_tree.sort_order,
         category_tree.cover_path,
         category_tree.created_at,
         category_tree.depth,
         COALESCE(cc.child_count, 0) AS child_count,
         COALESCE(mc.media_count, 0) AS media_count,
         array_to_string(category_tree.path_parts, ' / ') AS path
       FROM category_tree
       LEFT JOIN (SELECT parent_id, COUNT(*)::int AS child_count FROM categories GROUP BY parent_id) cc
         ON cc.parent_id = category_tree.id
       LEFT JOIN (SELECT category_id, COUNT(*)::int AS media_count FROM media_assets GROUP BY category_id) mc
         ON mc.category_id = category_tree.id
       ORDER BY category_tree.order_parts`,
      [request.accessTier]
    );
    return rows;
  });

  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `${CATEGORY_TREE_SQL}
       SELECT
         category_tree.id,
         category_tree.name,
         category_tree.description,
         category_tree.min_access_tier,
         category_tree.visible_parent_id AS parent_id,
         CASE WHEN $1 >= 100 THEN category_tree.parent_id ELSE NULL END AS stored_parent_id,
         category_tree.sort_order,
         category_tree.cover_path,
         category_tree.created_at,
         category_tree.depth,
         COALESCE(cc.child_count, 0) AS child_count,
         COALESCE(mc.media_count, 0) AS media_count,
         array_to_string(category_tree.path_parts, ' / ') AS path
       FROM category_tree
       LEFT JOIN (SELECT parent_id, COUNT(*)::int AS child_count FROM categories GROUP BY parent_id) cc
         ON cc.parent_id = category_tree.id
       LEFT JOIN (SELECT category_id, COUNT(*)::int AS media_count FROM media_assets GROUP BY category_id) mc
         ON mc.category_id = category_tree.id
       WHERE category_tree.id = $2`,
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
    const effectiveTier = min_access_tier ?? 0;

    if (!normalizedName) {
      return reply.code(400).send({ error: "Category name is required" });
    }

    if (normalizedParentId !== null) {
      const parent = await getAccessibleCategory(fastify.pg, normalizedParentId, request.accessTier);
      if (!parent) return sendMissingOrDeniedParent(fastify, reply, normalizedParentId);
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

  fastify.post("/:id/translate", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const gasUrl = process.env.TRANSLATOR_GAS_URL;
    const adminSecret = process.env.TRANSLATOR_ADMIN_SECRET || process.env.TRANSLATE_ADMIN_SECRET || "pfs_admin_secret_key_123";
    if (!gasUrl) {
      return reply.code(400).send({ error: "TRANSLATOR_GAS_URL is not configured" });
    }

    const categoryId = Number(request.params.id);
    const category = await getAccessibleCategory(fastify.pg, categoryId, request.accessTier);
    if (!category) {
      const exists = await categoryExists(fastify, categoryId);
      return exists ? reply.code(403).send({ error: "Access denied" }) : reply.code(404).send({ error: "Not found" });
    }

    const targetLang = (request.body?.targetLang || "id").trim().toLowerCase();

    const { rows: mediaList } = await fastify.pg.query(
      `SELECT m.id, m.title, m.artists, m.duration, m.mime_type, ml.language, ml.segments, ml.source AS lyrics_source
       FROM media_assets m
       LEFT JOIN media_lyrics ml ON ml.media_id = m.id
       WHERE m.category_id = $1
       ORDER BY m.track_order ASC, m.id ASC`,
      [categoryId]
    );

    if (mediaList.length === 0) {
      return reply.code(200).send({ success: true, count: 0, total: 0, targetLang });
    }

    let translatedCount = 0;

    for (const item of mediaList) {
      try {
        if (item.mime_type?.startsWith("audio/")) {
          let lyrics = item;
          if (!lyrics.segments) {
            lyrics = await resolveMediaLyrics(item, {
              pg: fastify.pg,
              redis: fastify.redis,
              log: request.log,
            });
          }

          if (lyrics && Array.isArray(lyrics.segments) && lyrics.segments.length > 0) {
            let itemSourceLang = (lyrics.language || "").trim().toLowerCase();
            const codeMap = { eng: "en", ind: "id", jpn: "ja", kor: "ko", spa: "es", fra: "fr", deu: "de", zho: "zh" };
            if (codeMap[itemSourceLang]) itemSourceLang = codeMap[itemSourceLang];
            if (itemSourceLang === targetLang || itemSourceLang === "und") {
              itemSourceLang = "";
            }

            const gasResponse = await fetch(gasUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                adminSecret,
                type: "lyrics",
                targetLang,
                sourceLang: itemSourceLang,
                segments: lyrics.segments,
              }),
            });

            if (gasResponse.ok) {
              const gasResult = await gasResponse.json().catch(() => ({}));
              if (Array.isArray(gasResult.segments)) {
                const mergedSegments = lyrics.segments.map((originalSegment, idx) => {
                  const translatedSegment = gasResult.segments[idx];
                  return {
                    start: originalSegment.start,
                    end: originalSegment.end,
                    text: originalSegment.text,
                    translation: translatedSegment?.text || "",
                  };
                });
                await fastify.pg.query(
                  `INSERT INTO media_lyrics (
                     media_id, language, segments, source, updated_at
                   ) VALUES ($1, $2, $3::jsonb, 'translated', NOW())
                   ON CONFLICT (media_id) DO UPDATE
                   SET language = EXCLUDED.language,
                       segments = EXCLUDED.segments,
                       source = 'translated',
                       updated_at = NOW()`,
                  [item.id, targetLang, JSON.stringify(mergedSegments)]
                );
                translatedCount += 1;
              }
            }
          }
        } else if (item.mime_type?.startsWith("video/")) {
          const { rows: subRows } = await fastify.pg.query(
            "SELECT * FROM media_subtitles WHERE media_id = $1 ORDER BY stream_index ASC LIMIT 1",
            [item.id]
          );
          if (subRows.length > 0 && subRows[0].vtt_path) {
            const vttFile = join(dataDir, subRows[0].vtt_path);
            const vttContent = await readFile(vttFile, "utf8").catch(() => null);
            if (vttContent) {
              const gasResponse = await fetch(gasUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  adminSecret,
                  type: "subtitle",
                  targetLang,
                  sourceLang: subRows[0].language !== "und" ? subRows[0].language : "",
                  content: vttContent,
                }),
              });

              if (gasResponse.ok) {
                const gasResult = await gasResponse.json().catch(() => ({}));
                if (typeof gasResult.content === "string") {
                  const { rows: maxRows } = await fastify.pg.query(
                    "SELECT COALESCE(MAX(stream_index), -1) AS max_index FROM media_subtitles WHERE media_id = $1",
                    [item.id]
                  );
                  const newStreamIndex = Number(maxRows[0]?.max_index ?? -1) + 1;
                  const subDir = join(dataDir, "subtitles", String(item.id));
                  await mkdir(subDir, { recursive: true });
                  const targetRelative = `subtitles/${item.id}/${item.id}_tr_${targetLang}_${newStreamIndex}.vtt`;
                  await writeFile(join(dataDir, targetRelative), gasResult.content, "utf8");

                  const langName = targetLang === "id" ? "Indonesian" : targetLang.toUpperCase();
                  await fastify.pg.query(
                    `INSERT INTO media_subtitles (
                       media_id, stream_index, language, title, format, is_default, has_ass_styling, vtt_path, ass_path, updated_at
                     ) VALUES ($1, $2, $3, $4, 'vtt', FALSE, FALSE, $5, NULL, NOW())`,
                    [item.id, newStreamIndex, targetLang, `${langName} (Translated)`, targetRelative]
                  );
                  translatedCount += 1;
                }
              }
            }
          }
        }
      } catch (itemErr) {
        request.log.warn({ err: itemErr, mediaId: item.id }, "failed translating category item");
      }
    }

    return reply.code(200).send({
      success: true,
      count: translatedCount,
      total: mediaList.length,
      targetLang,
    });
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
    const isBlurRequested = request.query?.blur === "1" || request.query?.blur === "true" || request.query?.size === "blur";
    const coverPath = rows[0].cover_path;
    const targetPath = isBlurRequested ? blurPathFromCover(coverPath) : coverPath;
    const filePath = join(dataDir, targetPath);
    try {
      return sendCoverFile({ request, reply, filePath, stats: await stat(filePath) });
    } catch {
      if (isBlurRequested) {
        const originalFilePath = join(dataDir, coverPath);
        try {
          await generateBlurCover({ inputPath: originalFilePath, outputPath: filePath });
          const stats = await stat(filePath);
          return sendCoverFile({ request, reply, filePath, stats });
        } catch {
          try {
            return sendCoverFile({ request, reply, filePath: originalFilePath, stats: await stat(originalFilePath) });
          } catch {
            return reply.code(404).send({ error: "No thumbnail available" });
          }
        }
      }
      return reply.code(404).send({ error: "No thumbnail available" });
    }
  });

  fastify.put("/:id/thumbnail", async (request, reply) => {
    if (request.accessTier < 100) return reply.code(403).send({ error: "Insufficient tier" });
    const category = await getAccessibleCategory(fastify.pg, request.params.id, request.accessTier);
    if (!category) return sendMissingOrDeniedCategory(fastify, reply, request.params.id);
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
        await unlinkCoverWithBlur(dataDir, category.cover_path);
      }
      return rows[0];
    } catch (error) {
      if (coverPath) await unlinkCoverWithBlur(dataDir, coverPath);
      request.log.warn({ err: error }, "category cover normalization failed");
      return reply.code(400).send({ error: "Thumbnail could not be converted to WebP" });
    } finally {
      await unlink(upload).catch(() => {});
    }
  });

  fastify.delete("/:id/thumbnail", async (request, reply) => {
    if (request.accessTier < 100) return reply.code(403).send({ error: "Insufficient tier" });
    const category = await getAccessibleCategory(fastify.pg, request.params.id, request.accessTier);
    if (!category) return sendMissingOrDeniedCategory(fastify, reply, request.params.id);
    await fastify.pg.query("UPDATE categories SET cover_path = NULL WHERE id = $1", [request.params.id]);
    if (category.cover_path) await unlinkCoverWithBlur(dataDir, category.cover_path);
    return reply.code(204).send();
  });

  fastify.put("/:id", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const { id } = request.params;
    const { name, description, min_access_tier, parent_id, apply_to_children } = request.body;
    const normalizedName = typeof name === "string" ? name.trim() : null;
    const hasParentId = Object.hasOwn(request.body, "parent_id");
    const normalizedParentId = normalizeNullableInt(parent_id);
    const existing = await getAccessibleCategory(fastify.pg, id, request.accessTier);

    if (!existing) return sendMissingOrDeniedCategory(fastify, reply, id);
    if (apply_to_children !== undefined && typeof apply_to_children !== "boolean") {
      return reply.code(400).send({ error: "apply_to_children must be a boolean" });
    }

    if (normalizedParentId !== null && normalizedParentId === Number.parseInt(id, 10)) {
      return reply.code(400).send({ error: "A category cannot be its own parent" });
    }

    const effectiveParentId = hasParentId ? normalizedParentId : existing.parent_id;
    const effectiveTier = min_access_tier ?? existing.min_access_tier;
    let effectiveSortOrder = existing.sort_order;

    if (effectiveParentId !== null && effectiveParentId !== existing.parent_id) {
      const parent = await getAccessibleCategory(fastify.pg, effectiveParentId, request.accessTier);
      if (!parent) return sendMissingOrDeniedParent(fastify, reply, effectiveParentId);
    }

    if (normalizedParentId !== null && await categoryHasDescendant(fastify, id, normalizedParentId)) {
      return reply.code(400).send({ error: "A category cannot be moved under its own child" });
    }

    if (hasParentId && effectiveParentId !== existing.parent_id) {
      const { rows: orderRows } = await fastify.pg.query(
        "SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order FROM categories WHERE parent_id IS NOT DISTINCT FROM $1 AND id <> $2",
        [effectiveParentId, id]
      );
      effectiveSortOrder = orderRows[0].next_order;
    }

    const updateSql = "UPDATE categories SET name = COALESCE($1, name), description = COALESCE($2, description), min_access_tier = $3, parent_id = $4, sort_order = $5 WHERE id = $6 RETURNING *";
    const updateParams = [normalizedName, description ?? null, effectiveTier, effectiveParentId, effectiveSortOrder, id];
    if (!apply_to_children) {
      const { rows } = await fastify.pg.query(updateSql, updateParams);
      return rows[0];
    }

    const client = await fastify.pg.connect();
    try {
      await client.query("BEGIN");
      await client.query("LOCK TABLE categories IN SHARE ROW EXCLUSIVE MODE");
      if (!await getAccessibleCategory(client, id, request.accessTier)) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "Access denied" });
      }
      if (effectiveParentId !== null && effectiveParentId !== existing.parent_id &&
          !await getAccessibleCategory(client, effectiveParentId, request.accessTier)) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "Access denied" });
      }
      if (normalizedParentId !== null && await categoryHasDescendant({ pg: client }, id, normalizedParentId)) {
        await client.query("ROLLBACK");
        return reply.code(400).send({ error: "A category cannot be moved under its own child" });
      }
      const { rowCount: inaccessibleChildren } = await client.query(
        `WITH RECURSIVE descendants AS (
           SELECT id, min_access_tier FROM categories WHERE parent_id = $1
           UNION ALL
           SELECT c.id, c.min_access_tier FROM categories c
           JOIN descendants d ON c.parent_id = d.id
         )
         SELECT 1 FROM descendants WHERE min_access_tier > $2 LIMIT 1`,
        [id, request.accessTier]
      );
      if (inaccessibleChildren > 0) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "Access denied to a child category" });
      }

      const { rows } = await client.query(updateSql, updateParams);
      await client.query(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM categories WHERE parent_id = $1
           UNION ALL
           SELECT c.id FROM categories c
           JOIN descendants d ON c.parent_id = d.id
         )
         UPDATE categories SET min_access_tier = $2
         WHERE id IN (SELECT id FROM descendants)`,
        [id, effectiveTier]
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
      if (!await getAccessibleCategory(client, categoryId, request.accessTier)) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "Access denied" });
      }

      if (parentId !== null) {
        const { rows: parentRows } = await client.query(
          "SELECT id, min_access_tier FROM categories WHERE id = $1 FOR UPDATE",
          [parentId]
        );
        if (!parentRows[0]) {
          await client.query("ROLLBACK");
          return reply.code(400).send({ error: "Parent category not found" });
        }
        if (!await getAccessibleCategory(client, parentId, request.accessTier)) {
          await client.query("ROLLBACK");
          return reply.code(403).send({ error: "Access denied" });
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
        "UPDATE categories SET parent_id = $1 WHERE id = $2",
        [parentId, categoryId]
      );
      for (const [index, id] of destinationIds.entries()) {
        await client.query("UPDATE categories SET sort_order = $1 WHERE id = $2", [index, id]);
      }

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
    const category = await getAccessibleCategory(fastify.pg, id, request.accessTier);
    if (!category) return sendMissingOrDeniedCategory(fastify, reply, id);

    if (await categoryHasChildren(fastify, id)) {
      return reply.code(409).send({ error: "Delete child categories first" });
    }

    const { rowCount } = await fastify.pg.query(
      "DELETE FROM categories WHERE id = $1 RETURNING cover_path",
      [id]
    );
    if (rowCount === 0) return reply.code(404).send({ error: "Not found" });
    if (category.cover_path) await unlinkCoverWithBlur(dataDir, category.cover_path);
    await rm(join(dataDir, String(id)), { recursive: true, force: true }).catch(() => {});
    return reply.code(204).send();
  });
}
