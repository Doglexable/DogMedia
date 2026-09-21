import { describe, expect, it, vi } from "vitest";
import {
  MAX_FINALIZATION_ATTEMPTS,
  getMessageDeliveryAttempts,
  processMediaFinalizationJob,
  runMediaFinalizationWorker,
} from "./media-finalization-worker.js";

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

  it("does not acknowledge a failed message before reaching max attempts, but acknowledges after exceeding max attempts", async () => {
    const controller = new AbortController();
    const log = { error: vi.fn(), fatal: vi.fn(), warn: vi.fn() };
    const pg = {
      query: vi.fn().mockRejectedValue(new Error("corrupted media")),
    };

    let attemptCount = 0;
    const ackCalls = [];

    const redis = {
      xgroup: vi.fn().mockResolvedValue("OK"),
      xautoclaim: vi.fn().mockImplementation(async () => {
        if (attemptCount >= 3) {
          controller.abort();
          return ["0-0", []];
        }
        attemptCount += 1;
        return ["0-0", [["msg-poison-1", ["mediaId", "99", "sourceVersion", "1"]]]];
      }),
      xreadgroup: vi.fn().mockResolvedValue([]),
      xpending: vi.fn().mockImplementation(async () => {
        return [["msg-poison-1", "consumer-1", 60000, attemptCount]];
      }),
      xack: vi.fn().mockImplementation(async (stream, group, id) => {
        ackCalls.push({ stream, group, id });
        controller.abort();
        return 1;
      }),
    };

    await runMediaFinalizationWorker({
      consumer: "consumer-1",
      dataDir: "/media",
      log,
      maxAttempts: MAX_FINALIZATION_ATTEMPTS,
      pg,
      redis,
      signal: controller.signal,
    });

    expect(attemptCount).toBe(MAX_FINALIZATION_ATTEMPTS);
    expect(redis.xack).toHaveBeenCalledTimes(1);
    expect(redis.xack).toHaveBeenCalledWith("media:finalization", "media-finalizers", "msg-poison-1");
    expect(ackCalls).toEqual([
      { stream: "media:finalization", group: "media-finalizers", id: "msg-poison-1" },
    ]);
    expect((log.fatal || log.error)).toHaveBeenCalledWith(
      expect.objectContaining({ attempts: 3, mediaId: "99", messageId: "msg-poison-1" }),
      expect.stringContaining("permanently failed after reaching max attempts")
    );
  });

  it("acknowledges immediately if message attempts field meets or exceeds max attempts", async () => {
    const controller = new AbortController();
    const log = { error: vi.fn(), fatal: vi.fn() };
    const pg = {
      query: vi.fn().mockRejectedValue(new Error("unrecoverable probe failure")),
    };

    const redis = {
      xgroup: vi.fn().mockResolvedValue("OK"),
      xautoclaim: vi.fn().mockResolvedValue(["0-0", []]),
      xreadgroup: vi.fn().mockResolvedValue([
        [
          "media:finalization",
          [["msg-already-failed", ["mediaId", "88", "sourceVersion", "1", "attempts", "3"]]],
        ],
      ]),
      xpending: vi.fn(),
      xack: vi.fn().mockImplementation(async () => {
        controller.abort();
        return 1;
      }),
    };

    await runMediaFinalizationWorker({
      consumer: "consumer-1",
      dataDir: "/media",
      log,
      maxAttempts: 3,
      pg,
      redis,
      signal: controller.signal,
    });

    expect(redis.xpending).not.toHaveBeenCalled();
    expect(redis.xack).toHaveBeenCalledWith("media:finalization", "media-finalizers", "msg-already-failed");
  });

  it("resolves message delivery attempts via fields or xpending", async () => {
    const redis = {
      xpending: vi.fn().mockResolvedValue([["msg-1", "consumer-1", 1000, 4]]),
    };

    await expect(
      getMessageDeliveryAttempts({ fields: { attempts: "2" }, messageId: "msg-1", redis })
    ).resolves.toBe(2);

    await expect(
      getMessageDeliveryAttempts({ fields: {}, messageId: "msg-1", redis })
    ).resolves.toBe(4);
    expect(redis.xpending).toHaveBeenCalledWith(
      "media:finalization", "media-finalizers", "msg-1", "msg-1", 1
    );

    redis.xpending.mockRejectedValueOnce(new Error("Redis offline"));
    await expect(
      getMessageDeliveryAttempts({ fields: {}, messageId: "msg-1", redis })
    ).resolves.toBe(1);
  });
});
