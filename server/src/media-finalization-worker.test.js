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
});
