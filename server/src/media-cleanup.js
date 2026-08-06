import * as defaultFs from "fs/promises";
import { join } from "path";

export const DEFAULT_ORPHAN_MEDIA_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ORPHAN_MEDIA_CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;

const MANAGED_MEDIA_FILE_RE = /^(\d+)(?:_thumb)?\.[^.]+$/;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getOrphanMediaCleanupConfig(env = process.env) {
  return {
    enabled: env.ORPHAN_MEDIA_CLEANUP_ENABLED !== "false",
    graceMs: parsePositiveInt(env.ORPHAN_MEDIA_CLEANUP_GRACE_MS, DEFAULT_ORPHAN_MEDIA_CLEANUP_GRACE_MS),
    intervalMs: parsePositiveInt(env.ORPHAN_MEDIA_CLEANUP_INTERVAL_MS, DEFAULT_ORPHAN_MEDIA_CLEANUP_INTERVAL_MS),
  };
}

function mediaIdFromManagedFilename(filename) {
  const match = MANAGED_MEDIA_FILE_RE.exec(filename);
  return match ? Number(match[1]) : null;
}

async function existingMediaIds(pg, ids) {
  const uniqueIds = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  if (uniqueIds.length === 0) return new Set();

  const { rows } = await pg.query(
    "SELECT id FROM media_assets WHERE id = ANY($1::int[])",
    [uniqueIds]
  );
  return new Set(rows.map((row) => Number(row.id)));
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
    for (const fileEntry of fileEntries) {
      if (!fileEntry.isFile()) {
        summary.skipped += 1;
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

    const existingIds = await existingMediaIds(pg, candidates.map((candidate) => candidate.mediaId));
    for (const candidate of candidates) {
      summary.scanned += 1;
      if (existingIds.has(candidate.mediaId)) {
        summary.skipped += 1;
        continue;
      }

      try {
        const fileStat = await fs.stat(candidate.path);
        if (now - fileStat.mtimeMs < graceMs) {
          summary.skipped += 1;
          continue;
        }

        await fs.rm(candidate.path, { force: true });
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

export function startOrphanMediaCleanupScheduler({ dataDir, env = process.env, log, pg }) {
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
      await cleanupOrphanMediaFiles({ dataDir, graceMs: config.graceMs, log, pg });
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

  return {
    run,
    stop() {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
