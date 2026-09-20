import { describe, expect, it, vi } from "vitest";
import { processMediaFinalizationJob } from "./media-finalization-worker.js";

describe("media finalization worker", () => {
  it("finishes metadata and queues encoding outside the upload request", async () => {
    const queries = [];
    const pg = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes("FROM media_assets m") && sql.includes("JOIN categories")) {
          return { rows: [{
            id: 9,
            category_id: 4,
            file_path: "4/9.bin",
            mime_type: "application/octet-stream",
            source_version: 2,
            duration: 15,
            artists: null,
            track_order: null,
            thumbnail_path: null,
            cover_path: "4/front.webp",
          }] };
        }
        if (sql.includes("UPDATE media_assets")) return { rows: [{ id: 9 }] };
        return { rows: [], rowCount: 0 };
      },
    };
    const redis = { xadd: vi.fn().mockResolvedValue("1-0") };

    await expect(processMediaFinalizationJob({
      dataDir: "/media",
      mediaId: 9,
      pg,
      redis,
      sourceVersion: 2,
    })).resolves.toEqual({ finalized: true });

    expect(queries.some(({ sql }) => sql.includes("INSERT INTO media_encoding_variants"))).toBe(true);
    expect(redis.xadd).toHaveBeenCalledWith(
      "media:encoding", "*", "mediaId", "9", "sourceVersion", "2"
    );
  });

  it("does not process a stale source version", async () => {
    const pg = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 9, source_version: 3 }] }),
    };
    const redis = { xadd: vi.fn() };

    await expect(processMediaFinalizationJob({
      dataDir: "/media",
      mediaId: 9,
      pg,
      redis,
      sourceVersion: 2,
    })).resolves.toEqual({ stale: true });
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it("switches a film MKV to its verified MP4 before queuing renditions", async () => {
    const queries = [];
    const pg = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes("FROM media_assets m") && sql.includes("JOIN categories")) {
          return { rows: [{
            id: 9,
            category_id: 4,
            file_path: "4/9.mkv",
            mime_type: "video/x-matroska",
            content_kind: "film",
            source_version: 2,
            duration: 15,
            thumbnail_path: "4/9/cover.webp",
            cover_path: null,
          }] };
        }
        if (sql.includes("SET file_path = $1, mime_type = $2")) return { rows: [{ id: 9 }] };
        if (sql.includes("UPDATE media_assets") && sql.includes("duration")) return { rows: [{ id: 9 }] };
        return { rows: [], rowCount: 0 };
      },
    };
    const redis = { xadd: vi.fn().mockResolvedValue("1-0") };
    const normalizeVideoSource = vi.fn().mockResolvedValue({
      absolutePath: "/media/4/9.mp4",
      filePath: "4/9.mp4",
      mimeType: "video/mp4",
      previousAbsolutePath: "/media/4/9.mkv",
    });

    await expect(processMediaFinalizationJob({
      dataDir: "/media",
      log: { info: vi.fn(), warn: vi.fn() },
      mediaId: 9,
      normalizeVideoSource,
      pg,
      redis,
      sourceVersion: 2,
    })).resolves.toEqual({ finalized: true });

    expect(normalizeVideoSource).toHaveBeenCalledWith(expect.objectContaining({
      dataDir: "/media",
      media: expect.objectContaining({ file_path: "4/9.mkv", content_kind: "film" }),
    }));
    expect(queries.some(({ sql, params }) => sql.includes("SET file_path = $1, mime_type = $2")
      && params[0] === "4/9.mp4" && params[1] === "video/mp4")).toBe(true);
    expect(queries.some(({ sql }) => sql.includes("status IN ('ready', 'skipped', 'failed')"))).toBe(true);
    expect(redis.xadd).toHaveBeenCalledWith("media:encoding", "*", "mediaId", "9", "sourceVersion", "2");
  });
});
