import * as fs from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ORPHAN_MEDIA_CLEANUP_GRACE_MS,
  cleanupOrphanMediaFiles,
  getOrphanMediaCleanupConfig,
  startOrphanMediaCleanupScheduler,
} from "./media-cleanup.js";

const DAY_MS = 24 * 60 * 60 * 1000;

let tempDirs = [];

async function tempDataDir() {
  const dir = await fs.mkdtemp(join(tmpdir(), "pfs-cleanup-"));
  tempDirs.push(dir);
  return dir;
}

async function writeManagedFile(dataDir, categoryId, filename, mtime = new Date("2026-08-04T00:00:00.000Z")) {
  const categoryDir = join(dataDir, String(categoryId));
  await fs.mkdir(categoryDir, { recursive: true });
  const filePath = join(categoryDir, filename);
  await fs.writeFile(filePath, filename);
  await fs.utimes(filePath, mtime, mtime);
  return filePath;
}

function fakePg(existingIds = []) {
  const existing = new Set(existingIds.map(Number));
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return {
        rows: params[0]
          .filter((id) => existing.has(Number(id)))
          .map((id) => ({ id })),
      };
    },
  };
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
  vi.useRealTimers();
});

describe("cleanupOrphanMediaFiles", () => {
  it("deletes orphan media files and thumbnails older than the grace period", async () => {
    const dataDir = await tempDataDir();
    const mediaFile = await writeManagedFile(dataDir, 7, "44.flac");
    const thumbFile = await writeManagedFile(dataDir, 7, "44_thumb.webp");

    const summary = await cleanupOrphanMediaFiles({
      dataDir,
      graceMs: DAY_MS,
      now: new Date("2026-08-06T00:00:00.000Z").getTime(),
      pg: fakePg([]),
    });

    expect(await exists(mediaFile)).toBe(false);
    expect(await exists(thumbFile)).toBe(false);
    expect(summary).toMatchObject({ scanned: 2, deleted: 2, errors: 0 });
  });

  it("keeps media files and thumbnails when their media id exists", async () => {
    const dataDir = await tempDataDir();
    const mediaFile = await writeManagedFile(dataDir, 7, "44.flac");
    const thumbFile = await writeManagedFile(dataDir, 7, "44_thumb.webp");

    const summary = await cleanupOrphanMediaFiles({
      dataDir,
      graceMs: DAY_MS,
      now: new Date("2026-08-06T00:00:00.000Z").getTime(),
      pg: fakePg([44]),
    });

    expect(await fs.readFile(mediaFile, "utf8")).toBe("44.flac");
    expect(await fs.readFile(thumbFile, "utf8")).toBe("44_thumb.webp");
    expect(summary).toMatchObject({ scanned: 2, deleted: 0, errors: 0 });
  });

  it("keeps orphan files newer than the grace period", async () => {
    const dataDir = await tempDataDir();
    const mediaFile = await writeManagedFile(dataDir, 7, "44.flac", new Date("2026-08-05T12:00:00.000Z"));

    const summary = await cleanupOrphanMediaFiles({
      dataDir,
      graceMs: DAY_MS,
      now: new Date("2026-08-06T00:00:00.000Z").getTime(),
      pg: fakePg([]),
    });

    expect(await exists(mediaFile)).toBe(true);
    expect(summary).toMatchObject({ scanned: 1, deleted: 0, errors: 0 });
  });

  it("ignores unmanaged dirs, nested dirs, and unknown filenames", async () => {
    const dataDir = await tempDataDir();
    await fs.mkdir(join(dataDir, "tmp"), { recursive: true });
    await fs.mkdir(join(dataDir, "7", "nested"), { recursive: true });
    const unknownFile = await writeManagedFile(dataDir, 7, "cover.jpg");

    const summary = await cleanupOrphanMediaFiles({
      dataDir,
      graceMs: DAY_MS,
      now: new Date("2026-08-06T00:00:00.000Z").getTime(),
      pg: fakePg([]),
    });

    expect(await exists(unknownFile)).toBe(true);
    expect(summary.scanned).toBe(0);
    expect(summary.deleted).toBe(0);
    expect(summary.skipped).toBeGreaterThanOrEqual(3);
  });

  it("continues after a stat or delete error and reports it", async () => {
    const dataDir = await tempDataDir();
    await writeManagedFile(dataDir, 7, "44.flac");
    const warn = vi.fn();
    const failingFs = {
      ...fs,
      stat: vi.fn().mockRejectedValueOnce(new Error("nope")),
    };

    const summary = await cleanupOrphanMediaFiles({
      dataDir,
      fs: failingFs,
      graceMs: DAY_MS,
      log: { warn },
      now: new Date("2026-08-06T00:00:00.000Z").getTime(),
      pg: fakePg([]),
    });

    expect(summary.errors).toBe(1);
    expect(warn).toHaveBeenCalled();
  });
});

describe("orphan media cleanup config and scheduler", () => {
  it("parses env controls with daily defaults", () => {
    expect(getOrphanMediaCleanupConfig({})).toEqual({
      enabled: true,
      graceMs: DEFAULT_ORPHAN_MEDIA_CLEANUP_GRACE_MS,
      intervalMs: DEFAULT_ORPHAN_MEDIA_CLEANUP_GRACE_MS,
    });
    expect(getOrphanMediaCleanupConfig({
      ORPHAN_MEDIA_CLEANUP_ENABLED: "false",
      ORPHAN_MEDIA_CLEANUP_GRACE_MS: "5000",
      ORPHAN_MEDIA_CLEANUP_INTERVAL_MS: "6000",
    })).toEqual({
      enabled: false,
      graceMs: 5000,
      intervalMs: 6000,
    });
  });

  it("does not overlap scheduler runs", async () => {
    vi.useFakeTimers();
    let release;
    const pg = {
      calls: 0,
      async query() {
        this.calls += 1;
        await new Promise((resolve) => {
          release = resolve;
        });
        return { rows: [] };
      },
    };
    const dataDir = await tempDataDir();
    await writeManagedFile(dataDir, 7, "44.flac");
    const scheduler = startOrphanMediaCleanupScheduler({
      dataDir,
      env: { ORPHAN_MEDIA_CLEANUP_INTERVAL_MS: "1000" },
      pg,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(pg.calls).toBe(1);
    release();
    await vi.runOnlyPendingTimersAsync();
    scheduler.stop();
  });
});
