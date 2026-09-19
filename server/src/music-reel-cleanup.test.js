import * as fs from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredMusicReels, startMusicReelCleanupScheduler } from "./music-reel-cleanup.js";

const tempDirs = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("expired music reel cleanup", () => {
  it("removes the rendered MP4 and its database record", async () => {
    const dataDir = await fs.mkdtemp(join(tmpdir(), "pfs-reel-cleanup-"));
    tempDirs.push(dataDir);
    const outputPath = "shares/music-reels/91.mp4";
    await fs.mkdir(join(dataDir, "shares/music-reels"), { recursive: true });
    await fs.writeFile(join(dataDir, outputPath), "video");
    const queries = [];
    const pg = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes("SELECT id, output_path")) return { rows: [{ id: 91, output_path: outputPath }] };
        return { rows: [], rowCount: 1 };
      },
    };

    const summary = await cleanupExpiredMusicReels({ dataDir, pg });

    await expect(fs.stat(join(dataDir, outputPath))).rejects.toThrow();
    expect(queries.some(({ sql, params }) => sql.includes("DELETE FROM music_share_reels") && params[0] === 91)).toBe(true);
    expect(summary).toEqual({ scanned: 1, deleted: 1, errors: 0 });
  });

  it("does not delete a path outside the media directory", async () => {
    const dataDir = await fs.mkdtemp(join(tmpdir(), "pfs-reel-cleanup-"));
    tempDirs.push(dataDir);
    const pg = {
      async query(sql) {
        if (sql.includes("SELECT id, output_path")) return { rows: [{ id: 92, output_path: "../keep.mp4" }] };
        throw new Error("database row should be retained for retry");
      },
    };

    const summary = await cleanupExpiredMusicReels({ dataDir, pg });
    expect(summary).toEqual({ scanned: 1, deleted: 0, errors: 1 });
  });

  it("does not overlap scheduled cleanup runs", async () => {
    vi.useFakeTimers();
    let finish;
    const cleanup = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const scheduler = startMusicReelCleanupScheduler({ cleanup, dataDir: "/tmp/media", intervalMs: 1000, pg: {} });
    await vi.advanceTimersByTimeAsync(2000);
    expect(cleanup).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    scheduler.stop();
  });
});
