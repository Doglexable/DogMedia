import { describe, expect, it, vi } from "vitest";
import { enqueueEncodingQuality, retryFailedEncoding } from "./encoding-queue.js";

describe("enqueueEncodingQuality", () => {
  it("deduplicates an already queued quality", async () => {
    const pg = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ quality: "high" }] })
      .mockResolvedValueOnce({ rows: [] }) };
    const redis = { xadd: vi.fn().mockResolvedValue("1-0") };
    await expect(enqueueEncodingQuality({ pg, redis, mediaId: 9, sourceVersion: 2, quality: "high" })).resolves.toBe(true);
    await expect(enqueueEncodingQuality({ pg, redis, mediaId: 9, sourceVersion: 2, quality: "high" })).resolves.toBe(false);
    expect(redis.xadd).toHaveBeenCalledTimes(1);
    expect(redis.xadd).toHaveBeenCalledWith("media:encoding:urgent", "*", "mediaId", "9", "sourceVersion", "2", "quality", "high");
  });

  it("rejects unknown qualities before touching the database", async () => {
    const pg = { query: vi.fn() };
    await expect(enqueueEncodingQuality({ pg, redis: {}, mediaId: 9, sourceVersion: 2, quality: "ultra" })).rejects.toThrow("Unsupported encoding quality");
    expect(pg.query).not.toHaveBeenCalled();
  });
});

describe("retryFailedEncoding", () => {
  it("keeps normal retries limited to failed variants", async () => {
    const pg = { query: vi.fn().mockResolvedValue({ rows: [{ source_version: 2 }] }) };
    const redis = { xadd: vi.fn().mockResolvedValue("1-0") };

    await expect(retryFailedEncoding({ pg, redis, mediaId: 9 })).resolves.toBe(true);
    expect(pg.query.mock.calls[0][1]).toEqual([9, false]);
    expect(redis.xadd).toHaveBeenCalledWith("media:encoding", "*", "mediaId", "9", "sourceVersion", "2");
  });

  it("can force ready video variants back through the encoder", async () => {
    const pg = { query: vi.fn().mockResolvedValue({ rows: [{ source_version: 4 }] }) };
    const redis = { xadd: vi.fn().mockResolvedValue("2-0") };

    await expect(retryFailedEncoding({ pg, redis, mediaId: 12, force: true })).resolves.toBe(true);
    expect(pg.query.mock.calls[0][1]).toEqual([12, true]);
    expect(pg.query.mock.calls[0][0]).toContain("$2::boolean AND v.status IN ('ready', 'skipped')");
  });
});
