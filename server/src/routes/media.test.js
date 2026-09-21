import Fastify from "fastify";
import { mkdir, mkdtemp, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import mediaRoutes, { decodeBrowseCursor, extFromFilename, mediaMetadataFromTags, parseByteRange, parseTrackOrder, resolveTrackOrder } from "./media.js";

describe("media browsing and ranges", () => {
  it("validates and clamps byte ranges", () => {
    expect(parseByteRange("bytes=10-999", 100)).toEqual({ start: 10, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=100-", 100)).toBeNull();
    expect(parseByteRange("bytes=0-1,5-6", 100)).toBeNull();
  });

  it("paginates with an opaque stable cursor", async () => {
    const source = [
      { id: 1, title: "Zulu", category_id: 7, category_path: "Music", category_order: [0], track_order: 1 },
      { id: 2, title: "Alpha", category_id: 7, category_path: "Music", category_order: [0], track_order: null },
      { id: 3, title: "Beta", category_id: 8, category_path: "Podcasts", category_order: [1], track_order: null },
    ];
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (!sql.includes("LEFT JOIN liked_music")) return { rows: [], rowCount: 0 };
        const cursorId = params.length > 3 ? Number(params.at(-2)) : 0;
        return { rows: source.filter((row) => row.id > cursorId).slice(0, Number(params.at(-1))) };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(mediaRoutes, { prefix: "/api/media" });

    const first = await app.inject({ method: "GET", url: "/api/media/browse?limit=1" });
    expect(first.statusCode).toBe(200);
    expect(first.json().items.map((item) => item.id)).toEqual([1]);
    expect(decodeBrowseCursor(first.json().nextCursor)).toMatchObject({
      categoryOrder: [0], categoryId: 7, trackOrder: 1, id: 1,
    });

    const second = await app.inject({ method: "GET", url: `/api/media/browse?limit=1&cursor=${first.json().nextCursor}` });
    expect(second.statusCode).toBe(200);
    expect(second.json().items.map((item) => item.id)).toEqual([2]);
    expect(new Set([...first.json().items, ...second.json().items].map((item) => item.id)).size).toBe(2);

    const invalid = await app.inject({ method: "GET", url: "/api/media/browse?cursor=broken" });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it("uses folder order, track number, and upload sequence instead of title", async () => {
    let capturedSql = "";
    const app = Fastify();
    app.decorate("pg", {
      async query(sql) {
        capturedSql = sql;
        return { rows: [] };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(mediaRoutes, { prefix: "/api/media" });

    const response = await app.inject({ method: "GET", url: "/api/media/browse" });
    expect(response.statusCode).toBe(200);
    expect(capturedSql).toContain("ORDER BY ac.order_parts");
    expect(capturedSql).toContain("COALESCE(m.track_order, 0)");
    expect(capturedSql).not.toContain("lower(coalesce(m.title");
    await app.close();
  });

  it("applies liked, category, and literal search filters", async () => {
    let captured;
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        captured = { sql, params };
        return { rows: [] };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 3;
      request.clientIp = "192.168.1.5";
    });
    await app.register(mediaRoutes, { prefix: "/api/media" });
    const response = await app.inject({ method: "GET", url: "/api/media/browse?view=liked&category_id=7&q=rock%25_&limit=10" });
    expect(response.statusCode).toBe(200);
    expect(captured.sql).toContain("lm.media_id IS NOT NULL");
    expect(captured.sql).toContain("m.category_id = $3");
    expect(captured.sql).toContain("ESCAPE");
    expect(captured.params).toEqual([3, "192.168.1.5", 7, "%rock\\%\\_%", 11]);
    await app.close();
  });

  it("applies media type filter for audio, video, photo, and rejects invalid types", async () => {
    let capturedSql = "";
    const app = Fastify();
    app.decorate("pg", {
      async query(sql) {
        capturedSql = sql;
        return { rows: [] };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(mediaRoutes, { prefix: "/api/media" });

    // Audio / Music
    const audioRes = await app.inject({ method: "GET", url: "/api/media/browse?type=audio" });
    expect(audioRes.statusCode).toBe(200);
    expect(capturedSql).toContain("m.mime_type LIKE 'audio/%'");

    const musicRes = await app.inject({ method: "GET", url: "/api/media/browse?type=music" });
    expect(musicRes.statusCode).toBe(200);
    expect(capturedSql).toContain("m.mime_type LIKE 'audio/%'");

    // Video
    const videoRes = await app.inject({ method: "GET", url: "/api/media/browse?type=video" });
    expect(videoRes.statusCode).toBe(200);
    expect(capturedSql).toContain("m.mime_type LIKE 'video/%'");

    // Photo / Image
    const photoRes = await app.inject({ method: "GET", url: "/api/media/browse?type=photo" });
    expect(photoRes.statusCode).toBe(200);
    expect(capturedSql).toContain("m.mime_type LIKE 'image/%'");

    // All
    const allRes = await app.inject({ method: "GET", url: "/api/media/browse?type=all" });
    expect(allRes.statusCode).toBe(200);
    expect(capturedSql).not.toContain("m.mime_type LIKE");

    // Invalid type
    const invalidRes = await app.inject({ method: "GET", url: "/api/media/browse?type=unknown_format" });
    expect(invalidRes.statusCode).toBe(400);
    expect(invalidRes.json().error).toBe("Invalid type filter");

    await app.close();
  });
});

describe("track order metadata", () => {
  it.each([
    ["05", 5],
    ["5/12", 5],
    [" 09 / 14 ", 9],
    [7, 7],
    ["", null],
    ["0", null],
    ["side-a", null],
    ["3 of 12", null],
  ])("parses %j as %j", (input, expected) => {
    expect(parseTrackOrder(input)).toBe(expected);
  });

  it.each([
    [{ TRACK: "03/12" }, 3],
    [{ tracknumber: "04" }, 4],
    [{ Track_Number: "05" }, 5],
  ])("reads case-insensitive track tags from %j", (tags, expected) => {
    expect(mediaMetadataFromTags(tags).trackOrder).toBe(expected);
  });

  it("prefers an explicit upload order over detected metadata", () => {
    expect(resolveTrackOrder("7", 2)).toBe(7);
    expect(resolveTrackOrder("", 2)).toBe(2);
    expect(resolveTrackOrder("", null)).toBeNull();
  });

  it("rescans audio metadata without clearing missing or failed rows", async () => {
    const updates = [];
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (sql.startsWith("SELECT id, file_path")) {
          return {
            rows: [
              { id: 1, file_path: "7/1.flac", track_order: null },
              { id: 2, file_path: "7/2.flac", track_order: 2 },
              { id: 3, file_path: "7/3.flac", track_order: 8 },
              { id: 4, file_path: "7/4.flac", track_order: 9 },
            ],
          };
        }
        if (sql.startsWith("UPDATE media_assets SET track_order")) {
          updates.push(params);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 100;
    });
    await app.register(mediaRoutes, {
      prefix: "/api/media",
      probeMediaTags: async (path) => {
        if (path.endsWith("1.flac")) return { trackOrder: 1 };
        if (path.endsWith("2.flac")) return { trackOrder: 2 };
        if (path.endsWith("3.flac")) return { trackOrder: null };
        return { probeFailed: true };
      },
    });

    const response = await app.inject({ method: "POST", url: "/api/media/track-orders/scan" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ scanned: 4, updated: 1, missing: 1, failed: 1 });
    expect(updates).toEqual([[1, 1]]);
    await app.close();
  });

  it("requires admin access for a metadata rescan", async () => {
    const app = Fastify();
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 99;
    });
    await app.register(mediaRoutes, { prefix: "/api/media" });

    const response = await app.inject({ method: "POST", url: "/api/media/track-orders/scan" });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe("chunked upload completion", () => {
  it("queues assembly and returns 202 without processing the source in the request", async () => {
    const uploadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const uploadDir = join("data", "tmp", "chunked", uploadId);
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, "manifest.json"), JSON.stringify({ file: { name: "film.mkv", totalChunks: 1 } }));

    const values = new Map();
    const app = Fastify();
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.decorate("redis", {
      async get(key) { return values.get(key) || null; },
      async set(key, value) { values.set(key, value); return "OK"; },
      async xadd() { return "1-0"; },
      async del(key) { values.delete(key); return 1; },
      async scan() { return ["0", [...values.keys()]]; },
      async mget(...keys) { return keys.map((key) => values.get(key) || null); },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 100;
    });
    await app.register(mediaRoutes, { prefix: "/api/media" });

    try {
      const complete = await app.inject({
        method: "POST",
        url: `/api/media/uploads/${uploadId}/complete`,
      });
      expect(complete.statusCode).toBe(202);
      expect(complete.json()).toEqual({ uploadId, status: "queued" });

      const status = await app.inject({
        method: "GET",
        url: `/api/media/uploads/${uploadId}/status`,
      });
      expect(status.statusCode).toBe(200);
      expect(status.headers["cache-control"]).toBe("no-store");
      expect(status.json()).toEqual(expect.objectContaining({
        uploadId,
        status: "queued",
        title: "film.mkv",
        fileName: "film.mkv",
      }));

      const queue = await app.inject({ method: "GET", url: "/api/media/uploads/queue" });
      expect(queue.statusCode).toBe(200);
      expect(queue.json()).toEqual(expect.objectContaining({
        summary: expect.objectContaining({ queued: 1, processing: 0 }),
        jobs: [expect.objectContaining({ uploadId, status: "queued", queuePosition: 1 })],
      }));
    } finally {
      await app.close();
      await rm(uploadDir, { recursive: true, force: true });
    }
  });
});

describe("quality-aware streaming", () => {
  it("requires a bound session, selects a ready tier, and serves ranges without caching", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-quality-route-"));
    await mkdir(join(dataDir, "7", "1", "v1"), { recursive: true });
    await writeFile(join(dataDir, "7", "1.mp3"), "original-media");
    await writeFile(join(dataDir, "7", "1", "v1", "med.m4a"), "medium-media");
    const app = Fastify();
    const redisValues = new Map();
    app.decorate("redis", {
      async get(key) { return redisValues.get(key) || null; },
      async set(key, value) { redisValues.set(key, value); return "OK"; },
      async del(key) { return redisValues.delete(key) ? 1 : 0; },
      async eval(script, keyCount, key, ...args) {
        if (script.includes("previousSessionId")) {
          redisValues.set(key, args[1]);
          return [1, Number(args[2]), ""];
        }
        if (script.includes("lastHeartbeatAt")) return [1, Number(args[3])];
        return 1;
      },
    });
    app.decorate("pg", {
      async query(sql) {
        if (sql.includes("SELECT quality, file_path") && sql.includes("media_encoding_variants")) {
          return { rows: [{ quality: "med", file_path: "7/1/v1/med.m4a", mime_type: "audio/mp4" }] };
        }
        if (sql.includes("FROM media_assets m")) {
          return { rows: [{ id: 1, category_id: 7, file_path: "7/1.mp3", mime_type: "audio/mpeg", source_version: 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(mediaRoutes, { prefix: "/api/media", dataDir });

    expect((await app.inject({ method: "GET", url: "/api/media/1/stream?quality=high" })).statusCode).toBe(401);
    const sessionResponse = await app.inject({
      method: "POST",
      url: "/api/media/1/playback-session",
      payload: { quality: "high" },
    });
    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json().sessionId).toBeTruthy();
    const setCookies = Array.isArray(sessionResponse.headers["set-cookie"])
      ? sessionResponse.headers["set-cookie"]
      : [sessionResponse.headers["set-cookie"]];
    expect(setCookies.join("; ")).toContain("HttpOnly");
    const cookie = setCookies.find((value) => value.startsWith("pfs_stream_1="))?.split(";")[0];
    const response = await app.inject({
      method: "GET",
      url: "/api/media/1/stream?quality=high",
      headers: { range: "bytes=0-5", cookie, "x-viewer-id": sessionResponse.json().viewerId },
    });
    expect(response.statusCode).toBe(206);
    expect(response.headers["x-media-quality"]).toBe("med");
    expect(response.headers["content-type"]).toContain("audio/mp4");
    expect(response.headers["cache-control"]).toBe("private, no-store, max-age=0");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(response.body).toBe("medium");
    expect((await app.inject({ method: "GET", url: "/api/media/1/stream?quality=ultra" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/media/1/playback-session", payload: { quality: "ori" } })).statusCode).toBe(403);
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
});

describe("media artwork", () => {
  it("prefers an item poster and falls back to the category cover", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-media-artwork-"));
    await mkdir(join(dataDir, "7", "1"), { recursive: true });
    await writeFile(join(dataDir, "7", "1", "cover.webp"), "item-cover");
    await writeFile(join(dataDir, "7", "front.webp"), "category-cover");

    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (sql.includes("FROM media_assets m")) {
          const id = Number(params.at(-1));
          return {
            rows: [{
              id,
              category_id: 7,
              thumbnail_path: id === 1 ? "7/1/cover.webp" : null,
            }],
            rowCount: 1,
          };
        }
        if (sql.startsWith("SELECT cover_path FROM categories")) {
          return { rows: [{ cover_path: "7/front.webp" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 0; });
    await app.register(mediaRoutes, { prefix: "/api/media", dataDir });

    const itemResponse = await app.inject({ method: "GET", url: "/api/media/1/thumbnail" });
    const fallbackResponse = await app.inject({ method: "GET", url: "/api/media/2/thumbnail" });
    expect(itemResponse.statusCode).toBe(200);
    expect(itemResponse.body).toBe("item-cover");
    expect(fallbackResponse.statusCode).toBe(200);
    expect(fallbackResponse.body).toBe("category-cover");

    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("deletes media files, thumbnails, and directory on DELETE /api/media/:id", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-delete-test-"));
    const catDir = join(dataDir, "7");
    const mediaDir = join(catDir, "1");
    await mkdir(mediaDir, { recursive: true });
    const mediaFile = join(catDir, "1.mp3");
    const thumbFile = join(mediaDir, "cover.webp");
    await writeFile(mediaFile, "audio");
    await writeFile(thumbFile, "thumb");

    let deletedMediaId = null;
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (sql.includes("SELECT file_path, category_id, thumbnail_path FROM media_assets")) {
          return {
            rows: [{ file_path: "7/1.mp3", category_id: 7, thumbnail_path: "7/1/cover.webp" }],
            rowCount: 1,
          };
        }
        if (sql.includes("DELETE FROM media_assets")) {
          deletedMediaId = params[0];
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, { prefix: "/api/media", dataDir });

    const res = await app.inject({ method: "DELETE", url: "/api/media/1" });
    expect(res.statusCode).toBe(204);
    expect(deletedMediaId).toBe("1");

    await expect(stat(mediaFile)).rejects.toThrow();
    await expect(stat(thumbFile)).rejects.toThrow();
    await expect(stat(mediaDir)).rejects.toThrow();

    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("triggers on-demand media cleanup on POST /api/media/cleanup", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-cleanup-route-"));
    const orphanFile = join(dataDir, "7", "99.mp3");
    await mkdir(join(dataDir, "7"), { recursive: true });
    await writeFile(orphanFile, "orphan-audio");

    const app = Fastify();
    app.decorate("pg", {
      async query(sql) {
        if (sql.includes("SELECT id FROM media_assets")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, { prefix: "/api/media", dataDir });

    const res = await app.inject({
      method: "POST",
      url: "/api/media/cleanup",
      payload: { graceMs: 0 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ scanned: 1, deleted: 1, errors: 0 });
    await expect(stat(orphanFile)).rejects.toThrow();

    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
});

describe("extFromFilename and path traversal prevention", () => {
  it("sanitizes file extensions and prevents path traversal", () => {
    expect(extFromFilename("song.mp3")).toBe("mp3");
    expect(extFromFilename("exploit.jpg/../../evil.sh")).toBe("sh");
    expect(extFromFilename("malicious..//\\")).toBe("bin");
  });

  it("handles multi-dot extensions, case normalization, and fallback defaults", () => {
    expect(extFromFilename("track.FLAC")).toBe("flac");
    expect(extFromFilename("archive.tar.gz")).toBe("gz");
    expect(extFromFilename("noextension")).toBe("bin");
    expect(extFromFilename("", "dat")).toBe("dat");
    expect(extFromFilename(null, "bin")).toBe("bin");
    expect(extFromFilename("payload.jpg/../../evil")).toBe("evil");
    expect(extFromFilename("malicious..//\\..", "bin")).toBe("bin");
  });
});
