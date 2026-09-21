import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_ENCODING_ATTEMPTS,
  getMessageDeliveryAttempts,
  processEncodingJob,
  runEncodingWorker,
} from "./encoding-worker.js";

describe("encoding worker retry and failure handling", () => {
  it("resolves message delivery attempts via fields or xpending", async () => {
    const redis = {
      xpending: vi.fn().mockResolvedValue([["msg-1", "consumer-1", 1000, 3]]),
    };

    await expect(
      getMessageDeliveryAttempts({ fields: { attempts: "2" }, messageId: "msg-1", redis })
    ).resolves.toBe(2);

    await expect(
      getMessageDeliveryAttempts({ fields: {}, messageId: "msg-1", redis })
    ).resolves.toBe(3);
    expect(redis.xpending).toHaveBeenCalledWith(
      "media:encoding", "media-encoders", "msg-1", "msg-1", 1
    );

    redis.xpending.mockRejectedValueOnce(new Error("Redis error"));
    await expect(
      getMessageDeliveryAttempts({ fields: {}, messageId: "msg-1", redis })
    ).resolves.toBe(1);

    await expect(
      getMessageDeliveryAttempts({ fields: {}, messageId: "msg-1", redis: {} })
    ).resolves.toBe(1);
  });

  it("rejects when probeSource fails on missing or unreadable source file", async () => {
    const pg = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          id: 42,
          category_id: 1,
          file_path: "missing/file.mp4",
          mime_type: "video/mp4",
          source_version: 1,
        }],
      }),
    };
    const probeSourceImpl = vi.fn().mockRejectedValue(new Error("ENOENT: file not found"));

    await expect(processEncodingJob({
      dataDir: "/media",
      log: { error: vi.fn(), warn: vi.fn() },
      mediaId: 42,
      pg,
      probeSourceImpl,
      sourceVersion: 1,
    })).rejects.toThrow("ENOENT: file not found");

    expect(probeSourceImpl).toHaveBeenCalledWith("/media/missing/file.mp4");
  });

  it("permanently acknowledges (xack) and does not re-add (xadd) after reaching max attempts", async () => {
    const controller = new AbortController();
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const queries = [];
    const pg = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }),
    };

    const redis = {
      xgroup: vi.fn().mockResolvedValue("OK"),
      xautoclaim: vi.fn().mockResolvedValue(["0-0", []]),
      xreadgroup: vi.fn().mockResolvedValue([
        [
          "media:encoding",
          [["msg-exhausted-1", ["mediaId", "99", "sourceVersion", "1", "attempts", "3"]]],
        ],
      ]),
      xpending: vi.fn(),
      xack: vi.fn().mockImplementation(async () => {
        controller.abort();
        return 1;
      }),
      xadd: vi.fn(),
    };

    const failingProcessJob = vi.fn().mockRejectedValue(new Error("ENOENT: file not found"));

    await runEncodingWorker({
      consumer: "test-consumer",
      dataDir: "/media",
      log,
      maxAttempts: MAX_ENCODING_ATTEMPTS,
      pg,
      processJob: failingProcessJob,
      redis,
      signal: controller.signal,
    });

    expect(redis.xack).toHaveBeenCalledTimes(1);
    expect(redis.xack).toHaveBeenCalledWith("media:encoding", "media-encoders", "msg-exhausted-1");
    expect(redis.xadd).not.toHaveBeenCalled();

    const failUpdate = queries.find(({ sql }) =>
      sql.includes("UPDATE media_encoding_variants SET status = 'failed'")
    );
    expect(failUpdate).toBeDefined();
    expect(failUpdate.params).toEqual([
      "ENOENT: file not found",
      99,
      1,
    ]);

    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ attempts: 3, mediaId: 99, sourceVersion: 1 }),
      "encoding permanently failed after reaching max attempts"
    );
  });

  it("terminates retry loop when message attempts reach 3 via xpending", async () => {
    const controller = new AbortController();
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const queries = [];
    const pg = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }),
    };

    const redis = {
      xgroup: vi.fn().mockResolvedValue("OK"),
      xautoclaim: vi.fn().mockResolvedValue(["0-0", []]),
      xreadgroup: vi.fn().mockResolvedValue([
        [
          "media:encoding",
          [["msg-pending-3", ["mediaId", "77", "sourceVersion", "1"]]],
        ],
      ]),
      xpending: vi.fn().mockResolvedValue([["msg-pending-3", "test-consumer", 60000, 3]]),
      xack: vi.fn().mockImplementation(async () => {
        controller.abort();
        return 1;
      }),
      xadd: vi.fn(),
    };

    const failingProcessJob = vi.fn().mockRejectedValue(new Error("ENOENT: missing video"));

    await runEncodingWorker({
      consumer: "test-consumer",
      dataDir: "/media",
      log,
      maxAttempts: 3,
      pg,
      processJob: failingProcessJob,
      redis,
      signal: controller.signal,
    });

    expect(redis.xack).toHaveBeenCalledWith("media:encoding", "media-encoders", "msg-pending-3");
    expect(redis.xadd).not.toHaveBeenCalled();
    expect(queries.some(({ sql }) => sql.includes("UPDATE media_encoding_variants SET status = 'failed'"))).toBe(true);
  });

  it("re-enqueues job with incremented attempts when attempts < maxAttempts", async () => {
    const controller = new AbortController();
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const queries = [];
    const pg = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }),
    };

    const redis = {
      xgroup: vi.fn().mockResolvedValue("OK"),
      xautoclaim: vi.fn().mockResolvedValue(["0-0", []]),
      xreadgroup: vi.fn().mockResolvedValue([
        [
          "media:encoding",
          [["msg-first-try", ["mediaId", "88", "sourceVersion", "2", "attempts", "1"]]],
        ],
      ]),
      xpending: vi.fn(),
      xack: vi.fn().mockImplementation(async () => {
        controller.abort();
        return 1;
      }),
      xadd: vi.fn().mockResolvedValue("1-0"),
    };

    const failingProcessJob = vi.fn().mockRejectedValue(new Error("ENOENT: file not found"));

    await runEncodingWorker({
      consumer: "test-consumer",
      dataDir: "/media",
      log,
      maxAttempts: 3,
      pg,
      processJob: failingProcessJob,
      redis,
      retryDelayFn: () => 0,
      signal: controller.signal,
    });

    expect(redis.xadd).toHaveBeenCalledWith(
      "media:encoding",
      "*",
      "mediaId", "88",
      "sourceVersion", "2",
      "attempts", "2"
    );
    expect(redis.xack).toHaveBeenCalledWith("media:encoding", "media-encoders", "msg-first-try");

    const queuedUpdate = queries.find(({ sql }) =>
      sql.includes("UPDATE media_encoding_variants SET status = 'queued'")
    );
    expect(queuedUpdate).toBeDefined();
    expect(queuedUpdate.params).toEqual([88, 2]);
  });

  it("successfully processes job and acknowledges without re-enqueuing", async () => {
    const controller = new AbortController();
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const pg = { query: vi.fn() };

    const redis = {
      xgroup: vi.fn().mockResolvedValue("OK"),
      xautoclaim: vi.fn().mockResolvedValue(["0-0", []]),
      xreadgroup: vi.fn().mockResolvedValue([
        [
          "media:encoding",
          [["msg-success-1", ["mediaId", "77", "sourceVersion", "1"]]],
        ],
      ]),
      xpending: vi.fn(),
      xack: vi.fn().mockImplementation(async () => {
        controller.abort();
        return 1;
      }),
      xadd: vi.fn(),
    };

    const successfulProcessJob = vi.fn().mockResolvedValue({ created: 3, skipped: 0 });

    await runEncodingWorker({
      consumer: "test-consumer",
      dataDir: "/media",
      log,
      maxAttempts: 3,
      pg,
      processJob: successfulProcessJob,
      redis,
      signal: controller.signal,
    });

    expect(successfulProcessJob).toHaveBeenCalledWith({
      dataDir: "/media",
      log,
      mediaId: 77,
      pg,
      sourceVersion: 1,
    });
    expect(redis.xack).toHaveBeenCalledWith("media:encoding", "media-encoders", "msg-success-1");
    expect(redis.xadd).not.toHaveBeenCalled();
  });

  it("catches and logs transient progress update database errors without failing the job", async () => {
    const log = { error: vi.fn(), warn: vi.fn() };
    const pg = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes("SELECT id, category_id")) {
          return {
            rows: [{
              id: 42,
              category_id: 1,
              file_path: "42.mp4",
              mime_type: "video/mp4",
              source_version: 1,
            }],
          };
        }
        if (sql.includes("SELECT quality, status FROM media_encoding_variants")) {
          return { rows: [] };
        }
        if (sql.includes("UPDATE media_encoding_variants SET progress_percent")) {
          throw new Error("transient db error");
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const probeSourceImpl = vi.fn().mockResolvedValue({
      hasAudio: true,
      hasVideo: true,
      audioStreamCount: 1,
      subtitleStreamCount: 0,
      bitrate: 10_000_000,
      duration: 100,
      videoBitrate: 8_000_000,
      audioBitrate: 320_000,
      width: 1920,
      height: 1080,
    });

    const runFfmpegImpl = vi.fn().mockImplementation(async ({ onProgress }) => {
      onProgress(20);
      onProgress(50);
      throw new Error("stop ffmpeg early for testing");
    });

    const testDir = await mkdtemp(join(tmpdir(), "encoding-test-"));
    try {
      await expect(processEncodingJob({
        dataDir: testDir,
        log,
        mediaId: 42,
        pg,
        probeSourceImpl,
        runFfmpegImpl,
        sourceVersion: 1,
      })).rejects.toThrow("stop ffmpeg early for testing");
    } finally {
      await rm(testDir, { force: true, recursive: true }).catch(() => {});
    }

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), mediaId: 42, quality: "low" }),
      "failed to update encoding variant progress"
    );
  });
});
