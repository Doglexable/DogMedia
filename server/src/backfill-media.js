import { access, mkdir, readdir, rename, stat } from "fs/promises";
import { join } from "path";
import pg from "pg";
import Redis from "ioredis";
import { normalizeCategoryCover } from "./category-cover.js";
import { enqueueEncoding } from "./encoding-queue.js";

const dryRun = process.argv.includes("--dry-run");
const dataDir = process.env.DATA_DIR || "data";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join(dataDir, `thumbnail-backup-${timestamp}`);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://pfs:pfs_secret@localhost:5432/pfs" });
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", { lazyConnect: true });
const report = { dryRun, categories: 0, coversCreated: 0, existingCovers: 0, conflicts: [], missingCovers: [], thumbnailsBackedUp: 0, mediaQueued: 0 };

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function legacyThumbnails(categoryId, mediaRows) {
  const files = await readdir(join(dataDir, String(categoryId))).catch(() => []);
  const available = new Set(files);
  const byMedia = [];
  for (const media of mediaRows) {
    const basename = String(media.file_path).split("/").at(-1).replace(/\.[^.]+$/, "");
    const filename = ["webp", "jpg", "jpeg", "png"].map((ext) => `${basename}_thumb.${ext}`).find((name) => available.has(name));
    if (filename) byMedia.push({ media, filename, path: join(dataDir, String(categoryId), filename) });
  }
  return byMedia;
}

try {
  await client.connect();
  const { rows: categories } = await client.query(
    `SELECT c.id, c.parent_id, c.cover_path,
            COALESCE(json_agg(json_build_object('id', m.id, 'file_path', m.file_path)
              ORDER BY (m.track_order IS NULL)::int, m.track_order, m.id)
              FILTER (WHERE m.id IS NOT NULL), '[]') AS media
     FROM categories c LEFT JOIN media_assets m ON m.category_id = c.id
     GROUP BY c.id ORDER BY c.id`
  );
  report.categories = categories.length;
  for (const category of categories) {
    const media = category.media || [];
    if (!media.length) continue;
    const legacy = await legacyThumbnails(category.id, media);
    if (legacy.length > 1) report.conflicts.push({ categoryId: category.id, candidates: legacy.map((item) => item.filename), selected: legacy[0].filename });
    let verifiedCover = category.cover_path && await exists(join(dataDir, category.cover_path));
    if (verifiedCover) report.existingCovers += 1;
    if (!verifiedCover && legacy[0]) {
      if (!dryRun) {
        const coverPath = await normalizeCategoryCover({ categoryId: category.id, dataDir, inputPath: legacy[0].path });
        await stat(join(dataDir, coverPath));
        await client.query("UPDATE categories SET cover_path = $1 WHERE id = $2", [coverPath, category.id]);
      }
      verifiedCover = true;
      report.coversCreated += 1;
    }
    if (!verifiedCover) report.missingCovers.push(category.id);
    if (verifiedCover && legacy.length) {
      for (const item of legacy) {
        if (!dryRun) {
          const destinationDir = join(backupDir, String(category.id));
          await mkdir(destinationDir, { recursive: true });
          await rename(item.path, join(destinationDir, item.filename));
        }
        report.thumbnailsBackedUp += 1;
      }
    }
  }

  const { rows: mediaRows } = await client.query(
    `SELECT m.id, m.source_version FROM media_assets m
     WHERE EXISTS (
       SELECT 1 FROM unnest(ARRAY['low','med','high']::text[]) quality
       WHERE NOT EXISTS (
         SELECT 1 FROM media_encoding_variants v
         WHERE v.media_id = m.id AND v.source_version = m.source_version AND v.quality = quality
       )
     ) ORDER BY m.id`
  );
  report.mediaQueued = mediaRows.length;
  if (!dryRun && mediaRows.length) {
    await redis.connect();
    for (const media of mediaRows) await enqueueEncoding({ pg: client, redis, mediaId: media.id, sourceVersion: media.source_version });
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await redis.quit().catch(() => {});
  await client.end().catch(() => {});
}
