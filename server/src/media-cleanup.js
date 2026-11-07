import * as defaultFs from "fs/promises";
import { basename, join } from "path";
import { blurPathFromCover } from "./category-cover.js";

export const DEFAULT_ORPHAN_MEDIA_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_ORPHAN_MEDIA_CLEANUP_GRACE_MS = 15 * 60 * 1000;

const MANAGED_MEDIA_FILE_RE = /^(\d+)(?:[-_][a-zA-Z0-9_-]+)?\.[^.]+$/;
const MANAGED_CATEGORY_COVER_RE = /^front(?:-[a-zA-Z0-9_-]+)?(?:\.webp|-blur\.webp)$/;
const MANAGED_MEDIA_COVER_RE = /^cover(?:-[a-zA-Z0-9_-]+)?(?:\.webp|-blur\.webp)$/;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getOrphanMediaCleanupConfig(env = process.env) {
  const enabled =
    env.MEDIA_CLEANUP_ENABLED !== "false" &&
    env.ORPHAN_MEDIA_CLEANUP_ENABLED !== "false";

  const rawGrace = env.MEDIA_CLEANUP_GRACE_MS ?? env.ORPHAN_MEDIA_CLEANUP_GRACE_MS;
  const rawInterval = env.MEDIA_CLEANUP_INTERVAL_MS ?? env.ORPHAN_MEDIA_CLEANUP_INTERVAL_MS;

  return {
    enabled,
    graceMs: parseNonNegativeInt(rawGrace, DEFAULT_ORPHAN_MEDIA_CLEANUP_GRACE_MS),
    intervalMs: parsePositiveInt(rawInterval, DEFAULT_ORPHAN_MEDIA_CLEANUP_INTERVAL_MS),
  };
}

function mediaIdFromManagedFilename(filename) {
  const match = MANAGED_MEDIA_FILE_RE.exec(filename);
  return match ? Number(match[1]) : null;
}

async function existingMediaAssets(pg, ids) {
  const uniqueIds = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  if (uniqueIds.length === 0 || !pg?.query) return new Map();

  const { rows } = await pg.query(
    "SELECT id, thumbnail_path FROM media_assets WHERE id = ANY($1::int[])",
    [uniqueIds]
  );
  return new Map(rows.map((row) => [Number(row.id), row]));
}

async function existingCategoryCover(pg, categoryId) {
  if (!pg?.query) return { exists: false, coverPath: null };
  const { rows } = await pg.query(
    "SELECT id, cover_path FROM categories WHERE id = ANY($1::int[])",
    [[Number(categoryId)]]
  );
  if (!rows || rows.length === 0) return { exists: false, coverPath: null };
  return { exists: true, coverPath: rows[0].cover_path ?? null, hasCoverField: "cover_path" in rows[0] };
}

export async function cleanupOrphanMediaFiles({ dataDir, fs = defaultFs, graceMs = DEFAULT_ORPHAN_MEDIA_CLEANUP_GRACE_MS, log, now = Date.now(), pg }) {
  const summary = {
    scanned: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
  };

  let categoryEntries;
  try {
    categoryEntries = await fs.readdir(dataDir, { withFileTypes: true });
  } catch (error) {
    summary.errors += 1;
    log?.warn?.({ err: error, dataDir }, "orphan media cleanup could not scan data directory");
    return summary;
  }

  for (const categoryEntry of categoryEntries) {
    if (!categoryEntry.isDirectory() || !/^\d+$/.test(categoryEntry.name)) {
      summary.skipped += 1;
      continue;
    }

    const categoryId = Number(categoryEntry.name);
    const categoryDir = join(dataDir, categoryEntry.name);
    let fileEntries;
    try {
      fileEntries = await fs.readdir(categoryDir, { withFileTypes: true });
    } catch (error) {
      summary.errors += 1;
      log?.warn?.({ err: error, categoryDir }, "orphan media cleanup could not scan category directory");
      continue;
    }

    const candidates = [];
    const categoryCovers = [];

    for (const fileEntry of fileEntries) {
      if (!fileEntry.isFile()) {
        if (fileEntry.isDirectory() && /^\d+$/.test(fileEntry.name)) {
          candidates.push({ mediaId: Number(fileEntry.name), path: join(categoryDir, fileEntry.name), recursive: true });
          continue;
        }
        summary.skipped += 1;
        continue;
      }

      if (MANAGED_CATEGORY_COVER_RE.test(fileEntry.name)) {
        categoryCovers.push({
          name: fileEntry.name,
          path: join(categoryDir, fileEntry.name),
        });
        continue;
      }

      const mediaId = mediaIdFromManagedFilename(fileEntry.name);
      if (mediaId === null) {
        summary.skipped += 1;
        continue;
      }

      candidates.push({
        mediaId,
        path: join(categoryDir, fileEntry.name),
      });
    }

    // Check orphan category covers
    if (categoryCovers.length > 0) {
      try {
        const catInfo = await existingCategoryCover(pg, categoryId);
        // If catInfo.exists is true but hasCoverField is false (e.g. basic mock without cover_path), skip to avoid false deletion
        if (catInfo.exists && !catInfo.hasCoverField) {
          summary.skipped += categoryCovers.length;
        } else {
          const activeCover = catInfo.coverPath ? basename(catInfo.coverPath) : null;
          const activeBlur = activeCover ? basename(blurPathFromCover(activeCover)) : null;

          for (const cover of categoryCovers) {
            summary.scanned += 1;
            const isOrphan = !catInfo.exists || (!activeCover) || (cover.name !== activeCover && cover.name !== activeBlur);
            if (!isOrphan) {
              summary.skipped += 1;
              continue;
            }

            try {
              const fileStat = await fs.stat(cover.path);
              if (now - fileStat.mtimeMs < graceMs) {
                summary.skipped += 1;
                continue;
              }
              await fs.rm(cover.path, { force: true });
              summary.deleted += 1;
            } catch (error) {
              summary.errors += 1;
              log?.warn?.({ err: error, path: cover.path }, "orphan media cleanup could not delete category cover");
            }
          }
        }
      } catch (error) {
        summary.errors += 1;
        log?.warn?.({ err: error, categoryId }, "orphan media cleanup failed checking category covers");
      }
    }

    const mediaMap = await existingMediaAssets(pg, candidates.map((candidate) => candidate.mediaId));
    for (const candidate of candidates) {
      summary.scanned += 1;
      const mediaRow = mediaMap.get(candidate.mediaId);
      if (mediaRow) {
        // If it's a media folder (recursive), also check for abandoned cover-*.webp inside
        if (candidate.recursive && "thumbnail_path" in mediaRow) {
          try {
            const activeThumb = mediaRow.thumbnail_path ? basename(mediaRow.thumbnail_path) : null;
            const activeBlurThumb = activeThumb ? basename(blurPathFromCover(activeThumb)) : null;
            const innerFiles = await fs.readdir(candidate.path, { withFileTypes: true });

            for (const inner of innerFiles) {
              if (inner.isFile() && MANAGED_MEDIA_COVER_RE.test(inner.name)) {
                if (inner.name !== activeThumb && inner.name !== activeBlurThumb) {
                  const innerPath = join(candidate.path, inner.name);
                  try {
                    const innerStat = await fs.stat(innerPath);
                    if (now - innerStat.mtimeMs >= graceMs) {
                      await fs.rm(innerPath, { force: true });
                      summary.deleted += 1;
                    }
                  } catch (err) {
                    log?.warn?.({ err, path: innerPath }, "failed to remove orphan media cover");
                  }
                }
              }
            }
          } catch (err) {
            log?.warn?.({ err, path: candidate.path }, "could not scan inner media directory");
          }
        }

        summary.skipped += 1;
        continue;
      }

      try {
        const fileStat = await fs.stat(candidate.path);
        if (now - fileStat.mtimeMs < graceMs) {
          summary.skipped += 1;
          continue;
        }

        await fs.rm(candidate.path, { force: true, recursive: Boolean(candidate.recursive) });
        summary.deleted += 1;
      } catch (error) {
        summary.errors += 1;
        log?.warn?.({ err: error, path: candidate.path }, "orphan media cleanup could not delete file");
      }
    }
  }

  log?.info?.(summary, "orphan media cleanup finished");
  return summary;
}

export function startOrphanMediaCleanupScheduler({ cleanup = cleanupOrphanMediaFiles, dataDir, env = process.env, log, pg }) {
  const config = getOrphanMediaCleanupConfig(env);
  if (!config.enabled) {
    log?.info?.("orphan media cleanup disabled");
    return null;
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await cleanup({ dataDir, graceMs: config.graceMs, log, pg });
    } catch (error) {
      log?.warn?.({ err: error }, "orphan media cleanup failed");
    } finally {
      running = false;
    }
  };

  const startupTimer = setTimeout(run, 1000);
  startupTimer.unref?.();
  const intervalTimer = setInterval(run, config.intervalMs);
  intervalTimer.unref?.();

  log?.info?.(
    { intervalMs: config.intervalMs, graceMs: config.graceMs },
    "orphan media cleanup scheduler started"
  );

  return {
    run,
    stop() {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
