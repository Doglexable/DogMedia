import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import mediaRoutes, { decodeBrowseCursor, mediaMetadataFromTags, parseByteRange, parseTrackOrder, resolveTrackOrder } from "./media.js";

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
