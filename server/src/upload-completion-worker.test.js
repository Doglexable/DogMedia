import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./routes/media.js", () => ({
  processChunkedMediaUpload: vi.fn(),
}));

import { processChunkedMediaUpload } from "./routes/media.js";
import { processUploadCompletionJob } from "./upload-completion-worker.js";

function fakeRedis() {
  return {
    values: [],
    stored: new Map(),
    async get(key) {
      return this.stored.get(key) || null;
    },
    async set(key, value) {
      this.stored.set(key, value);
      this.values.push({ key, value: JSON.parse(value) });
      return "OK";
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upload completion worker", () => {
  it("publishes processing and completed states around background assembly", async () => {
    const media = { id: 42, title: "Film" };
    processChunkedMediaUpload.mockResolvedValue(media);
    const redis = fakeRedis();

    await expect(processUploadCompletionJob({
      fastify: {}, log: {}, redis, uploadId: "upload-id",
    })).resolves.toEqual(media);

    expect(redis.values.map(({ value }) => value)).toEqual([
      expect.objectContaining({ status: "processing", uploadId: "upload-id" }),
      expect.objectContaining({ status: "completed", uploadId: "upload-id", media }),
    ]);
  });

  it("publishes a failed state when assembly fails", async () => {
    processChunkedMediaUpload.mockRejectedValue(new Error("missing chunk"));
    const redis = fakeRedis();

    await expect(processUploadCompletionJob({
      fastify: {}, log: {}, redis, uploadId: "upload-id",
    })).rejects.toThrow("missing chunk");
    expect(redis.values.at(-1).value).toEqual(expect.objectContaining({
      status: "failed",
      uploadId: "upload-id",
      error: "missing chunk",
    }));
  });
  it("tracks and removes active upload IDs in Redis set", async () => {
    const media = { id: 42, title: "Film" };
    processChunkedMediaUpload.mockResolvedValue(media);
    const redis = fakeRedis();
    const activeSet = new Set();
    redis.sadd = vi.fn(async (_key, id) => { activeSet.add(id); return 1; });
    redis.srem = vi.fn(async (_key, id) => { activeSet.delete(id); return 1; });

    await processUploadCompletionJob({
      fastify: {}, log: {}, redis, uploadId: "upload-123",
    });

    expect(redis.sadd).toHaveBeenCalledWith("media:upload-completion:active_ids", "upload-123");
    expect(redis.srem).toHaveBeenCalledWith("media:upload-completion:active_ids", "upload-123");
    expect(activeSet.has("upload-123")).toBe(false);
  });
});
