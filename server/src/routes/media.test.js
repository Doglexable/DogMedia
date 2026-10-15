import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import mediaRoutes, { decodeBrowseCursor, extFromFilename, mediaMetadataFromTags, normalizeClientPlatform, parseByteRange, parseTrackOrder, processChunkedMediaUpload, resolveTrackOrder } from "./media.js";

describe("desktop playback identity", () => {
  it("normalizes explicit platforms and preserves fallbacks", () => {
    expect(normalizeClientPlatform({ "x-client-platform": " DESKTOP ", "x-viewer-id": "viewer" })).toBe("desktop");
    expect(normalizeClientPlatform({ "x-client-platform": "MOBILE" })).toBe("mobile");
    expect(normalizeClientPlatform({ "x-client-platform": "watch", "x-viewer-id": "viewer" })).toBe("mobile");
    expect(normalizeClientPlatform({ "x-client-platform": "watch" })).toBe("web");
    expect(normalizeClientPlatform({ "x-viewer-id": "viewer" })).toBe("mobile");
    expect(normalizeClientPlatform({})).toBe("web");
  });
});

describe("media resource id validation", () => {
  it("rejects malformed ids before querying media for reads and mutations", async () => {
    const query = vi.fn();
    const app = Fastify();
    app.decorate("pg", { query });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, { prefix: "/api/media" });

    const routes = [
      { method: "GET", url: "/api/media/abc" },
      { method: "GET", url: "/api/media/abc/stream" },
      { method: "GET", url: "/api/media/abc/thumbnail" },
      { method: "PUT", url: "/api/media/abc", payload: {} },
      { method: "DELETE", url: "/api/media/abc" },
      { method: "POST", url: "/api/media/abc/encoding/retry", payload: {} },
      { method: "GET", url: "/api/media/12abc" },
      { method: "GET", url: "/api/media/0" },
      { method: "GET", url: "/api/media/2147483648" },
    ];
    for (const route of routes) {
      const response = await app.inject(route);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Invalid media id" });
    }
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("media browsing and ranges", () => {
  it("keeps category-name search scoped to accessible media while using the indexed name expression", async () => {
    let sql = "";
    const app = Fastify();
    app.decorate("pg", { async query(query) { sql = query; return { rows: [] }; } });
    app.addHook("onRequest", async (request) => { request.accessTier = 0; request.clientIp = "127.0.0.1"; });
    await app.register(mediaRoutes, { prefix: "/api/media" });
    const result = await app.inject({ method: "GET", url: "/api/media/browse?q=Anime" });
    expect(result.statusCode).toBe(200);
    expect(sql).toContain("JOIN accessible_categories ac ON ac.id = m.category_id");
    expect(sql).toMatch(/OR m\.category_id IN\s*\(\s*SELECT id FROM categories\s*WHERE lower\(name\) LIKE lower\(\$3\)/);
    expect(sql).not.toContain("lower(ac.name) LIKE");
    await app.close();
  });

  it("returns consecutive bounded media-list pages in stable order", async () => {
    const source = Array.from({ length: 205 }, (_, i) => ({ id: i + 1 }));
    const queries = [];
    const app = Fastify();
    app.decorate("pg", { async query(sql, params) {
      queries.push({ sql, params });
      return { rows: source.slice(Number(params.at(-1)), Number(params.at(-1)) + Number(params.at(-2))) };
    } });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, { prefix: "/api/media" });
    const pages = [];
    for (const offset of [0, 100, 200]) {
      const response = await app.inject({ method: "GET", url: `/api/media?category_id=7&limit=100&offset=${offset}` });
      expect(response.statusCode).toBe(200);
      pages.push(response.json());
    }
    expect(pages.map((page) => page.length)).toEqual([100, 100, 5]);
    expect(pages.flat().map((item) => item.id)).toEqual(source.map((item) => item.id));
    expect(queries[0].params).toEqual([100, "7", 100, 0]);
    expect(queries[0].sql).toMatch(/ORDER BY ac\.order_parts,[\s\S]*m\.id LIMIT \$3 OFFSET \$4/);
    const defaultResponse = await app.inject({ method: "GET", url: "/api/media" });
    expect(defaultResponse.json()).toHaveLength(100);
    expect(queries.at(-1).params).toEqual([100, 100, 0]);
    await app.close();
  });

  it("rejects invalid media-list pagination before querying", async () => {
    const query = vi.fn();
    const app = Fastify();
    app.decorate("pg", { query });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, { prefix: "/api/media" });
    for (const param of ["limit=0", "limit=101", "limit=1.5", "limit=abc", "offset=-1", "offset=1.5", "offset=abc", "offset=9007199254740992"]) {
      const result = await app.inject({ method: "GET", url: `/api/media?${param}` });
      expect(result.statusCode).toBe(400);
    }
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

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
    expect(captured.sql).toContain(
      "lower(coalesce(m.title, '') || ' ' || coalesce(m.artists, '') || ' ' || coalesce(m.description, '')) LIKE lower($4) ESCAPE '\\'"
    );
    expect(captured.sql).toContain("SELECT id FROM categories");
    expect(captured.sql).toContain("lower(name) LIKE lower($4) ESCAPE '\\'");
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
        if (sql.includes("SELECT m.id, m.file_path, m.track_order")) {
          expect(sql).toContain("JOIN accessible_categories ac");
          return {
            rows: [
              { id: 1, file_path: "7/1.flac", track_order: null },
              { id: 2, file_path: "7/2.flac", track_order: 2 },
              { id: 3, file_path: "7/3.flac", track_order: 8 },
              { id: 4, file_path: "7/4.flac", track_order: 9 },
            ],
          };
        }
        if (sql.includes("UPDATE media_assets m SET track_order")) {
          expect(sql).toContain("FROM accessible_categories ac");
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
    expect(updates).toEqual([[100, 1, 1]]);
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
    const sets = new Map();
    let scanCalled = false;
    const app = Fastify();
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.decorate("redis", {
      async get(key) { return values.get(key) || null; },
      async set(key, value) { values.set(key, value); return "OK"; },
      async xadd() { return "1-0"; },
      async del(key) { values.delete(key); sets.delete(key); return 1; },
      async sadd(key, ...members) {
        if (!sets.has(key)) sets.set(key, new Set());
        for (const m of members) sets.get(key).add(m);
        return members.length;
      },
      async srem(key, ...members) {
        const set = sets.get(key);
        if (!set) return 0;
        let count = 0;
        for (const m of members) {
          if (set.delete(m)) count++;
        }
        return count;
      },
      async smembers(key) {
        const set = sets.get(key);
        return set ? [...set] : [];
      },
      async scan() { scanCalled = true; return ["0", [...values.keys()]]; },
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
      expect(scanCalled).toBe(false);
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
          const current = redisValues.has(key) ? JSON.parse(redisValues.get(key)) : null;
          if (current && (current.viewerId !== args[0] || current.clientIp !== args[1])) {
            return [0, JSON.stringify(current), 15000];
          }
          redisValues.set(key, args[2]);
          return [1, Number(args[3]), current?.sessionId || ""];
        }
        if (script.includes("lastHeartbeatAt")) return [1, Number(args[4])];
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
    const lowSession = await app.inject({
      method: "POST",
      url: "/api/media/1/playback-session",
      payload: { quality: "low" },
      headers: { "x-viewer-id": sessionResponse.json().viewerId },
    });
    expect(lowSession.statusCode).toBe(200);
    const lowCookie = (Array.isArray(lowSession.headers["set-cookie"])
      ? lowSession.headers["set-cookie"]
      : [lowSession.headers["set-cookie"]])
      .find((value) => value.startsWith("pfs_stream_1="))?.split(";")[0];
    const lowResponse = await app.inject({
      method: "GET",
      url: "/api/media/1/stream?quality=low",
      headers: { cookie: lowCookie, "x-viewer-id": lowSession.json().viewerId },
    });
    expect(lowResponse.statusCode).toBe(200);
    expect(lowResponse.headers["x-media-quality"]).toBe("med");
    expect(lowResponse.body).toBe("medium-media");
    expect((await app.inject({ method: "GET", url: "/api/media/1/stream?quality=ultra" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/media/1/playback-session", payload: { quality: "ori" } })).statusCode).toBe(403);
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("reports the safe holder on acquisition conflict without sensitive identifiers", async () => {
    const app = Fastify();
    const redisValues = new Map([
      ["stream:exclusive:standard", JSON.stringify({
        viewerId: "viewer_holder_hhhhhhhhhhhh",
        sessionId: "session_holder_hhhhhhhhhhh",
        mediaId: 9,
        clientIp: "10.0.0.9",
        platform: "desktop",
        deviceLabel: "Studio PC",
      })],
    ]);
    app.decorate("redis", {
      async get(key) { return redisValues.get(key) || null; },
      async set(key, value) { redisValues.set(key, value); return "OK"; },
      async del(key) { return redisValues.delete(key) ? 1 : 0; },
      async eval(script, keyCount, key, ...args) {
        if (script.includes("previousSessionId")) {
          const current = redisValues.has(key) ? JSON.parse(redisValues.get(key)) : null;
          if (current && (current.viewerId !== args[0] || current.clientIp !== args[1])) {
            return [0, JSON.stringify(current), 15000];
          }
          redisValues.set(key, args[2]);
          return [1, Number(args[3]), current?.sessionId || ""];
        }
        return 1;
      },
    });
    app.decorate("pg", {
      async query() {
        return { rows: [{ id: 1, duration: 200, mime_type: "audio/mpeg", source_version: 1 }], rowCount: 1 };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(mediaRoutes, { prefix: "/api/media" });

    const conflict = await app.inject({
      method: "POST",
      url: "/api/media/1/playback-session",
      payload: { quality: "high" },
      headers: {
        "x-viewer-id": "viewer_requester_rrrrrrrr",
        "x-client-platform": "web",
        "x-client-name": "Requester Laptop",
      },
    });
    expect(conflict.statusCode).toBe(409);
    const body = conflict.json();
    expect(body.code).toBe("PLAYBACK_IN_USE");
    expect(body.error).toContain("Studio PC");
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.activeSession).toMatchObject({
      platform: "desktop",
      deviceLabel: "Studio PC",
      mediaId: 9,
    });
    // The requester's own label must not leak into someone else's conflict.
    expect(body.activeSession.deviceLabel).not.toBe("Requester Laptop");
    // No sensitive identifiers anywhere in the payload.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("viewer_holder_hhhhhhhhhhhh");
    expect(raw).not.toContain("session_holder_hhhhhhhhhhh");
    expect(raw).not.toContain("10.0.0.9");
    expect(raw).not.toContain("viewer_requester_rrrrrrrr");
    expect(body).not.toHaveProperty("viewerId");
    expect(body).not.toHaveProperty("sessionId");
    await app.close();
  });
});

describe("artwork palettes", () => {
  it("serves the stored palette for accessible media without running Python again", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-palette-route-"));
    await mkdir(join(dataDir, "7"));
    const filePath = join(dataDir, "7/front.webp");
    await writeFile(filePath, "artwork");
    const fileStat = await stat(filePath);
    const fileFingerprint = `${fileStat.size}:${Math.trunc(fileStat.mtimeMs)}`;
    const colors = [{ hex: "#b6ae5d", percentage: 100 }];
    const query = vi.fn(async (sql) => {
      if (sql.includes("AS artwork_path")) return { rows: [{ artwork_path: "7/front.webp" }] };
      if (sql.includes("FROM artwork_palettes")) return { rows: [{ colors, algorithm_version: 1, file_fingerprint: fileFingerprint }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const app = Fastify();
    app.decorate("pg", { query });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, { prefix: "/api/media", dataDir });
    const response = await app.inject({ method: "GET", url: "/api/media/1/artwork-palette" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ colors, accent: "#b6ae5d" });
    expect(response.headers["cache-control"]).toBe("private, no-store");
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

  it("deletes media files, thumbnails, media directory, and subtitles on DELETE /api/media/:id", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-delete-test-"));
    const catDir = join(dataDir, "7");
    const mediaDir = join(catDir, "1");
    const subtitleDir = join(dataDir, "subtitles", "1");
    await mkdir(mediaDir, { recursive: true });
    await mkdir(subtitleDir, { recursive: true });
    const mediaFile = join(catDir, "1.mp3");
    const thumbFile = join(mediaDir, "cover.webp");
    const subtitleFile = join(subtitleDir, "1_0.vtt");
    await writeFile(mediaFile, "audio");
    await writeFile(thumbFile, "thumb");
    await writeFile(subtitleFile, "WEBVTT");

    let deletedMediaId = null;
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (sql.includes("SELECT m.file_path, m.category_id, m.thumbnail_path")
          && sql.includes("JOIN accessible_categories ac")) {
          return {
            rows: [{ file_path: "7/1.mp3", category_id: 7, thumbnail_path: "7/1/cover.webp" }],
            rowCount: 1,
          };
        }
        if (sql.includes("DELETE FROM media_assets")) {
          deletedMediaId = params[1];
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
    await expect(stat(subtitleDir)).rejects.toThrow();

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

describe("media mutations in accessible categories", () => {
  it("scopes PUT to an accessible category and distinguishes restricted from missing media", async () => {
    const media = new Map([
      ["1", { id: 1, category_id: 7, title: "Before" }],
      ["2", { id: 2, category_id: 9, title: "Restricted" }],
    ]);
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (sql.includes("UPDATE media_assets m")) {
          expect(sql).toContain("FROM accessible_categories ac");
          expect(params[0]).toBe(100);
          const id = params.at(-1);
          const row = media.get(id);
          if (!row || row.category_id !== 7) return { rows: [] };
          const updated = { ...row, title: params[1] };
          media.set(id, updated);
          return { rows: [updated] };
        }
        if (sql === "SELECT 1 FROM media_assets WHERE id = $1") {
          return { rowCount: Number(media.has(params[0])) };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, { prefix: "/api/media" });

    const denied = await app.inject({ method: "PUT", url: "/api/media/2", payload: { title: "Changed" } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "Access denied" });
    expect(media.get("2").title).toBe("Restricted");
    expect((await app.inject({ method: "PUT", url: "/api/media/3", payload: { title: "Missing" } })).statusCode).toBe(404);
    const allowed = await app.inject({ method: "PUT", url: "/api/media/1", payload: { title: "Changed" } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().title).toBe("Changed");
    await app.close();
  });

  it("keeps restricted files and rows intact on DELETE and deletes accessible media", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-scoped-delete-"));
    const restrictedPath = join(dataDir, "9", "2.mp3");
    const allowedPath = join(dataDir, "7", "1.mp3");
    const movedPath = join(dataDir, "7", "4.mp3");
    await mkdir(join(dataDir, "9"));
    await mkdir(join(dataDir, "7"));
    await writeFile(restrictedPath, "restricted");
    await writeFile(allowedPath, "allowed");
    await writeFile(movedPath, "moved");
    const media = new Map([
      ["1", { id: 1, category_id: 7, file_path: "7/1.mp3", thumbnail_path: null }],
      ["2", { id: 2, category_id: 9, file_path: "9/2.mp3", thumbnail_path: null }],
      ["4", { id: 4, category_id: 7, file_path: "7/4.mp3", thumbnail_path: null }],
    ]);
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (sql.includes("SELECT m.file_path, m.category_id, m.thumbnail_path")) {
          expect(sql).toContain("JOIN accessible_categories ac");
          const row = media.get(params[1]);
          return { rows: row?.category_id === 7 ? [row] : [] };
        }
        if (sql === "SELECT 1 FROM media_assets WHERE id = $1") return { rowCount: Number(media.has(params[0])) };
        if (sql.includes("DELETE FROM media_assets m USING accessible_categories ac")) {
          if (params[1] === "4") {
            media.set("4", { ...media.get("4"), category_id: 9 });
            return { rowCount: 0 };
          }
          media.delete(params[1]);
          return { rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, { prefix: "/api/media", dataDir });
    try {
      expect((await app.inject({ method: "DELETE", url: "/api/media/2" })).statusCode).toBe(403);
      expect(media.has("2")).toBe(true);
      expect(await readFile(restrictedPath, "utf8")).toBe("restricted");
      expect((await app.inject({ method: "DELETE", url: "/api/media/3" })).statusCode).toBe(404);
      expect((await app.inject({ method: "DELETE", url: "/api/media/4" })).statusCode).toBe(403);
      expect(await readFile(movedPath, "utf8")).toBe("moved");
      expect((await app.inject({ method: "DELETE", url: "/api/media/1" })).statusCode).toBe(204);
      expect(media.has("1")).toBe(false);
      await expect(stat(allowedPath)).rejects.toThrow();
    } finally {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("checks an accessible category before retrying or force-normalizing encoding", async () => {
    const xadd = vi.fn().mockResolvedValue("1-0");
    const query = vi.fn(async (sql, params) => {
      if (sql.includes("SELECT m.id, m.file_path, m.mime_type, m.content_kind, m.source_version")) {
        expect(sql).toContain("JOIN accessible_categories ac");
        return { rows: params[1] === "1" ? [{
          id: 1, category_id: 7, file_path: "7/1.mp4", mime_type: "video/mp4", source_version: 1,
        }] : [] };
      }
      if (sql === "SELECT 1 FROM media_assets WHERE id = $1") return { rowCount: Number(params[0] === "2") };
      if (sql.includes("UPDATE media_encoding_variants v")) return { rows: [{ source_version: 1 }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const app = Fastify();
    app.decorate("pg", { query });
    app.decorate("redis", { xadd });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, { prefix: "/api/media" });

    for (const force of [false, true]) {
      const denied = await app.inject({ method: "POST", url: "/api/media/2/encoding/retry", payload: { force } });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ error: "Access denied" });
    }
    expect((await app.inject({ method: "POST", url: "/api/media/3/encoding/retry" })).statusCode).toBe(404);
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE media_encoding_variants v"))).toBe(false);
    expect(xadd).not.toHaveBeenCalled();

    const allowed = await app.inject({ method: "POST", url: "/api/media/1/encoding/retry" });
    expect(allowed.statusCode).toBe(202);
    expect(xadd).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rejects restricted upload categories and keeps accessible uploads working", async () => {
    const categoryId = String(Date.now());
    const restrictedId = String(Number(categoryId) + 1);
    const mediaId = 123456789;
    const categoryDir = join("data", categoryId);
    const restrictedDir = join("data", restrictedId);
    const xadd = vi.fn().mockResolvedValue("1-0");
    const query = vi.fn(async (sql, params) => {
      if (sql.includes("SELECT c.id, c.parent_id, c.cover_path")) {
        expect(sql).toContain("JOIN accessible_categories ac");
        return { rows: params[1] === categoryId ? [{ id: categoryId, parent_id: null, cover_path: null }] : [] };
      }
      if (sql === "SELECT 1 FROM categories WHERE id = $1") return { rowCount: Number(params[0] === restrictedId) };
      if (sql.startsWith("INSERT INTO media_assets")) return { rows: [{ id: mediaId }] };
      if (sql.startsWith("UPDATE media_assets SET file_path")) {
        return { rows: [{ id: mediaId, category_id: categoryId, file_path: params[0], source_version: 1 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    const app = Fastify();
    app.decorate("pg", { query });
    app.decorate("redis", { xadd });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(multipart);
    await app.register(mediaRoutes, { prefix: "/api/media" });

    const upload = (targetCategory) => {
      const boundary = "pfs-accessible-category-boundary";
      const payload = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="category_id"\r\n\r\n${targetCategory}\r\n`
        + `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nSong\r\n`
        + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="song.mp3"\r\nContent-Type: audio/mpeg\r\n\r\naudio\r\n`
        + `--${boundary}--\r\n`
      );
      return { method: "POST", url: "/api/media", payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
    };
    try {
      const denied = await app.inject(upload(restrictedId));
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ error: "Access denied" });
      expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO media_assets"))).toBe(false);
      await expect(stat(restrictedDir)).rejects.toThrow();
      const missing = await app.inject(upload(String(Number(restrictedId) + 1)));
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toEqual({ error: "Category not found" });

      const allowed = await app.inject(upload(categoryId));
      expect(allowed.statusCode).toBe(201);
      expect(await readFile(join(categoryDir, `${mediaId}.mp3`), "utf8")).toBe("audio");
      expect(xadd).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
      await rm(categoryDir, { recursive: true, force: true });
    }
  });

  it.each(["file", "thumbnail", "lyrics", "ignored"])(
    "rejects an oversized %s part without persisting media or leaving temp files",
    async (oversizedField) => {
      const query = vi.fn();
      const app = Fastify();
      app.decorate("pg", { query });
      app.addHook("onRequest", async (request) => { request.accessTier = 100; });
      await app.register(multipart, { limits: { fileSize: 8 } });
      await app.register(mediaRoutes, { prefix: "/api/media" });

      const boundary = "pfs-direct-upload-limit-boundary";
      const filePart = (name, contents) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.txt"\r\nContent-Type: text/plain\r\n\r\n${contents}\r\n`;
      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="category_id"\r\n\r\n7\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nSong\r\n`,
        filePart("file", oversizedField === "file" ? "123456789" : "short"),
      ];
      if (oversizedField !== "file") parts.push(filePart(oversizedField, "123456789"));
      parts.push(`--${boundary}--\r\n`);
      const tempDir = join("data", "tmp", "multipart");
      const before = await readdir(tempDir).catch(() => []);
      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/media",
          payload: Buffer.from(parts.join("")),
          headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        });
        expect(response.statusCode).toBe(413);
        expect(response.json()).toEqual({
          error: "File exceeds the 20MB direct-upload limit; use /api/media/uploads for chunked upload",
        });
        expect(query).not.toHaveBeenCalled();
        expect(await readdir(tempDir)).toEqual(before);
      } finally {
        await app.close();
      }
    }
  );

  it("rejects restricted chunked upload targets before writing a manifest", async () => {
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (sql.includes("SELECT c.id FROM categories c")) {
          expect(sql).toContain("JOIN accessible_categories ac");
          return { rows: params[1] === 7 ? [{ id: 7 }] : [] };
        }
        if (sql === "SELECT 1 FROM categories WHERE id = $1") return { rowCount: Number(params[0] === 9) };
        throw new Error(`Unexpected query: ${sql}`);
      },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, { prefix: "/api/media" });
    const request = (category_id) => ({
      method: "POST", url: "/api/media/uploads",
      payload: { category_id, title: "Song", fileName: "song.mp3", fileSize: 5 },
    });

    const denied = await app.inject(request(9));
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject(request(7));
    expect(allowed.statusCode).toBe(201);
    const uploadDir = join("data", "tmp", "chunked", allowed.json().uploadId);
    try {
      const manifest = JSON.parse(await readFile(join(uploadDir, "manifest.json"), "utf8"));
      expect(manifest.accessTier).toBe(100);
    } finally {
      await app.close();
      await rm(uploadDir, { recursive: true, force: true });
    }
  });

  it("scopes chunked replacement to an accessible category at initiation and completion", async () => {
    const app = Fastify();
    const query = vi.fn(async (sql, params) => {
      if (sql.includes("SELECT m.id FROM media_assets m")) {
        expect(sql).toContain("JOIN accessible_categories ac");
        return { rows: Number(params[1]) === 1 ? [{ id: 1 }] : [] };
      }
      if (sql === "SELECT 1 FROM media_assets WHERE id = $1") return { rowCount: Number(Number(params[0]) === 2) };
      throw new Error(`Unexpected query: ${sql}`);
    });
    app.decorate("pg", { query });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, { prefix: "/api/media" });
    const request = (replaceMediaId) => ({
      method: "POST", url: "/api/media/uploads",
      payload: { replaceMediaId, fileName: "new.mp3", fileSize: 5 },
    });

    expect((await app.inject(request(2))).statusCode).toBe(403);
    expect((await app.inject(request(3))).statusCode).toBe(404);
    const allowed = await app.inject(request(1));
    expect(allowed.statusCode).toBe(201);
    const allowedDir = join("data", "tmp", "chunked", allowed.json().uploadId);
    const deniedId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const deniedDir = join("data", "tmp", "chunked", deniedId);
    try {
      expect(JSON.parse(await readFile(join(allowedDir, "manifest.json"), "utf8")).accessTier).toBe(100);
      await mkdir(deniedDir, { recursive: true });
      await writeFile(join(deniedDir, "manifest.json"), JSON.stringify({
        replaceMediaId: 2, accessTier: 100, fields: {}, file: null, thumbnail: null,
      }));
      await expect(processChunkedMediaUpload({ fastify: app, log: {}, uploadId: deniedId })).rejects.toThrow("Access denied");
      expect(query.mock.calls.some(([sql]) => sql.startsWith("UPDATE media_assets"))).toBe(false);
    } finally {
      await app.close();
      await rm(allowedDir, { recursive: true, force: true });
      await rm(deniedDir, { recursive: true, force: true });
    }
  });

  it("scans track order only in accessible categories", async () => {
    const updates = [];
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (sql.includes("SELECT m.id, m.file_path, m.track_order")) {
          expect(sql).toContain("JOIN accessible_categories ac");
          expect(params).toEqual([100]);
          return { rows: [{ id: 1, file_path: "7/1.mp3", track_order: null }] };
        }
        if (sql.includes("UPDATE media_assets m SET track_order")) {
          updates.push(params);
          return { rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(mediaRoutes, {
      prefix: "/api/media",
      probeMediaTags: async () => ({ trackOrder: 4 }),
    });
    const response = await app.inject({ method: "POST", url: "/api/media/track-orders/scan" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ scanned: 1, updated: 1, missing: 0, failed: 0 });
    expect(updates).toEqual([[100, 4, 1]]);
    await app.close();
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
