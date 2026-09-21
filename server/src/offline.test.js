import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  buildOfflineFileVersion,
  isNewerOfflineResume,
  normalizeOfflineEvent,
  normalizeOfflineResume,
} from "./offline.js";
import {
  fetchVariantsBatch,
  manifestItems,
  resolveQualityFile,
} from "./routes/offline.js";

describe("offline synchronization helpers", () => {
  it("derives a stable version from file size and modification time", () => {
    expect(buildOfflineFileVersion({ size: 1234, mtimeMs: 5678.9 })).toBe("1234:5678");
  });

  it("normalizes valid playback events and rejects malformed identifiers", () => {
    expect(normalizeOfflineEvent({
      clientEventId: "123e4567-e89b-42d3-a456-426614174000",
      mediaId: "7",
      action: "play",
      position: 12.8,
      duration: 90,
      occurredAt: "2026-08-17T00:00:00.000Z",
    })).toMatchObject({ mediaId: 7, action: "play", position: 12 });
    expect(normalizeOfflineEvent({ clientEventId: "bad", mediaId: 7, action: "play" })).toBeNull();
  });

  it("normalizes resumes and resolves conflicts by timestamp", () => {
    const resume = normalizeOfflineResume({ mediaId: 3, position: 30, duration: 100, updatedAt: "2026-08-17T00:00:00Z" });
    expect(resume).toMatchObject({ mediaId: 3, position: 30, duration: 100 });
    expect(isNewerOfflineResume(resume.updatedAt, "2026-08-16T00:00:00Z")).toBe(true);
    expect(isNewerOfflineResume(resume.updatedAt, "2026-08-18T00:00:00Z")).toBe(false);
  });
});

describe("batch media variant resolution", () => {
  it("queries variants in a single batch with ANY($1::int[]) and groups by mediaId and sourceVersion", async () => {
    const queries = [];
    const pg = {
      async query(sql, params) {
        queries.push({ sql, params });
        return {
          rows: [
            { media_id: 1, source_version: 1, quality: "high", file_path: "1/v1/high.mp3", mime_type: "audio/mpeg" },
            { media_id: 1, source_version: 1, quality: "low", file_path: "1/v1/low.mp3", mime_type: "audio/mpeg" },
            { media_id: 2, source_version: 3, quality: "high", file_path: "2/v3/high.mp3", mime_type: "audio/mpeg" },
          ],
        };
      },
    };

    const variantsMap = await fetchVariantsBatch(pg, [1, 2, 1, 0, -5, "bad", null]);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("WHERE media_id = ANY($1::int[]) AND status = 'ready'");
    expect(queries[0].params[0]).toEqual([1, 2]);
    expect(variantsMap.get("1:1")).toHaveLength(2);
    expect(variantsMap.get("2:3")).toHaveLength(1);
    expect(variantsMap.has("3:1")).toBe(false);
  });

  it("returns an empty map without querying database when no valid media IDs are provided", async () => {
    const queries = [];
    const pg = {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [] };
      },
    };

    const result = await fetchVariantsBatch(pg, [0, -1, "foo", null]);
    expect(result.size).toBe(0);
    expect(queries).toHaveLength(0);
  });

  it("uses preloaded variants in resolveQualityFile without database roundtrips", async () => {
    const queries = [];
    const pg = {
      async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [] };
      },
    };

    const preloaded = new Map([
      ["10:2", [{ quality: "high", file_path: "10/v2/high.mp3", mime_type: "audio/mpeg" }]],
    ]);

    const row = { id: 10, source_version: 2, file_path: "10/ori.mp3", mime_type: "audio/flac" };

    // When requesting ori, never queries DB or checks preloaded
    const oriResult = await resolveQualityFile(pg, row, "ori", preloaded);
    expect(oriResult).toEqual({ path: "10/ori.mp3", mimeType: "audio/flac", quality: "ori" });
    expect(queries).toHaveLength(0);

    // When requesting high with preloaded variants, uses preloaded without DB query
    const highResult = await resolveQualityFile(pg, row, "high", preloaded);
    expect(highResult).toEqual({ path: "10/v2/high.mp3", mimeType: "audio/mpeg", quality: "high" });
    expect(queries).toHaveLength(0);

    // When preloaded has no ready variants for this row, falls back to ori without DB query
    const missingRow = { id: 99, source_version: 1, file_path: "99/ori.mp3", mime_type: "audio/flac" };
    const fallbackResult = await resolveQualityFile(pg, missingRow, "high", preloaded);
    expect(fallbackResult).toEqual({ path: "99/ori.mp3", mimeType: "audio/flac", quality: "ori" });
    expect(queries).toHaveLength(0);
  });

  it("manifestItems executes 1 query for all variant lookups regardless of row count", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-manifest-test-"));
    try {
      await mkdir(join(dataDir, "1/v1"), { recursive: true });
      await mkdir(join(dataDir, "2/v1"), { recursive: true });
      await mkdir(join(dataDir, "3/v1"), { recursive: true });
      await writeFile(join(dataDir, "1/v1/high.mp3"), "track-1-audio");
      await writeFile(join(dataDir, "2/v1/high.mp3"), "track-2-audio");
      await writeFile(join(dataDir, "3/v1/high.mp3"), "track-3-audio");

      const queries = [];
      const pg = {
        async query(sql, params) {
          queries.push({ sql, params });
          return {
            rows: [
              { media_id: 1, source_version: 1, quality: "high", file_path: "1/v1/high.mp3", mime_type: "audio/mpeg" },
              { media_id: 2, source_version: 1, quality: "high", file_path: "2/v1/high.mp3", mime_type: "audio/mpeg" },
              { media_id: 3, source_version: 1, quality: "high", file_path: "3/v1/high.mp3", mime_type: "audio/mpeg" },
            ],
          };
        },
      };

      const rows = [
        { id: 1, category_id: 1, source_version: 1, file_path: "1/ori.mp3", mime_type: "audio/flac", title: "T1" },
        { id: 2, category_id: 1, source_version: 1, file_path: "2/ori.mp3", mime_type: "audio/flac", title: "T2" },
        { id: 3, category_id: 1, source_version: 1, file_path: "3/ori.mp3", mime_type: "audio/flac", title: "T3" },
      ];

      const items = await manifestItems(rows, dataDir, pg, "high");
      expect(items).toHaveLength(3);
      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toContain("WHERE media_id = ANY($1::int[])");
      expect(queries[0].params[0]).toEqual([1, 2, 3]);
      expect(items.map((i) => i.quality)).toEqual(["high", "high", "high"]);

      // For ori quality, 0 queries are executed
      queries.length = 0;
      await writeFile(join(dataDir, "1/ori.mp3"), "track-1-ori");
      await writeFile(join(dataDir, "2/ori.mp3"), "track-2-ori");
      await writeFile(join(dataDir, "3/ori.mp3"), "track-3-ori");
      const oriItems = await manifestItems(rows, dataDir, pg, "ori");
      expect(oriItems).toHaveLength(3);
      expect(queries).toHaveLength(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
