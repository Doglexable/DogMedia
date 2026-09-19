import * as defaultFs from "fs/promises";
import { resolve, sep } from "path";

export const MUSIC_REEL_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MUSIC_REEL_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function reelFilePath(dataDir, outputPath) {
  if (!outputPath) return null;
  const root = resolve(dataDir);
  const filePath = resolve(root, outputPath);
  if (!filePath.startsWith(`${root}${sep}`)) throw new Error("Reel output path leaves the media directory");
  return filePath;
}

export async function cleanupExpiredMusicReels({ dataDir, fs = defaultFs, log, pg }) {
  const { rows } = await pg.query(
    `SELECT id, output_path FROM music_share_reels
     WHERE expires_at <= NOW()
        OR created_at <= NOW() - INTERVAL '1 day'
        OR revoked_at IS NOT NULL`
  );
  const summary = { scanned: rows.length, deleted: 0, errors: 0 };

  for (const row of rows) {
    try {
      const filePath = reelFilePath(dataDir, row.output_path);
      if (filePath) await fs.rm(filePath, { force: true });
      await pg.query(
        `DELETE FROM music_share_reels
         WHERE id = $1 AND (
           expires_at <= NOW()
           OR created_at <= NOW() - INTERVAL '1 day'
           OR revoked_at IS NOT NULL
         )`,
        [row.id]
      );
      summary.deleted += 1;
    } catch (error) {
      summary.errors += 1;
      log?.warn?.({ err: error, reelId: row.id }, "expired music reel cleanup failed");
    }
  }

  log?.info?.(summary, "expired music reel cleanup finished");
  return summary;
}

export function startMusicReelCleanupScheduler({
  cleanup = cleanupExpiredMusicReels, dataDir, intervalMs = MUSIC_REEL_CLEANUP_INTERVAL_MS, log, pg,
}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await cleanup({ dataDir, log, pg });
    } catch (error) {
      log?.warn?.({ err: error }, "expired music reel cleanup failed");
    } finally {
      running = false;
    }
  };
  const startupTimer = setTimeout(run, 1000);
  startupTimer.unref?.();
  const intervalTimer = setInterval(run, intervalMs);
  intervalTimer.unref?.();
  return {
    run,
    stop() {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
