import Fastify from "fastify";
import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import musicShareRoutes, { boundedClipStart, lyricLeadInStart } from "./music-shares.js";

describe("lyric-aware reel timing", () => {
  it("starts two seconds before the earliest timed lyric", () => {
    expect(lyricLeadInStart([{ start: 18 }, { start: 7.5 }, { start: 12 }])).toBe(5.5);
    expect(lyricLeadInStart([{ start: 1.25 }])).toBe(0);
  });

  it("falls back to the start for missing or invalid timing", () => {
    expect(lyricLeadInStart(null)).toBe(0);
    expect(lyricLeadInStart([{ start: "not-a-time" }, {}])).toBe(0);
  });

  it("keeps a chosen window inside the track", () => {
    expect(boundedClipStart(17.25, 60)).toBe(17.25);
    expect(boundedClipStart(58, 60)).toBe(50);
    expect(boundedClipStart(4, 8)).toBe(0);
  });
});

describe("music reel owner routes", () => {
  it("queues an ordered reel and never persists the raw token", async () => {
    const writes = [];
    const queued = [];
    const client = {
      async query(sql, params) {
        writes.push({ sql, params });
        if (sql.includes("INSERT INTO music_share_reels")) {
          return { rows: [{ id: 91, status: "queued", progress: 0, created_at: new Date(), expires_at: new Date(Date.now() + 604_800_000) }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    const app = Fastify();
    app.decorate("redis", { async xadd(...args) { queued.push(args); } });
    app.decorate("pg", {
      async query(sql) {
        if (sql.includes("FROM requested")) return { rows: [
          { id: 4, title: "Night Drive", artists: "The Dogs", source_version: 1, position: 1, lyrics_segments: [{ start: 12, end: 15, text: "Go" }] },
          { id: 8, title: "Blue Hour", artists: "The Dogs", source_version: 2, position: 2 },
        ], rowCount: 2 };
        return { rows: [], rowCount: 0 };
      },
      async connect() { return client; },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; request.clientIp = "192.168.1.20"; });
    await app.register(musicShareRoutes, { prefix: "/api/music-shares" });

    const response = await app.inject({ method: "POST", url: "/api/music-shares", payload: { mediaIds: [4, 8], expiresInDays: 7 } });
    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({ reelId: 91, status: "queued", trackCount: 2, mediaIds: [4, 8], aspectRatio: "4:3", clipSeconds: 10 });
    expect(body.sharePath).toBe(`/shared/music#${body.token}`);
    const insert = writes.find((entry) => entry.sql.includes("INSERT INTO music_share_reels"));
    expect(insert.params[1]).toBe(createHash("sha256").update(body.token).digest("hex"));
    expect(insert.params[2]).toBe(1);
    expect(insert.params).not.toContain(body.token);
    const itemWrites = writes.filter((entry) => entry.sql.includes("INSERT INTO music_share_reel_items"));
    expect(itemWrites).toHaveLength(1);
    expect(itemWrites[0].params[4]).toBe(10);
    expect(itemWrites[0].params[11]).toBe(0);
    expect(queued).toHaveLength(1);
    await app.close();
  });

  it("rejects duplicate, oversized, and non-favorite selections", async () => {
    const app = Fastify();
    app.decorate("redis", { async xadd() {} });
    app.decorate("pg", {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { throw new Error("should not connect"); },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; request.clientIp = "127.0.0.1"; });
    await app.register(musicShareRoutes, { prefix: "/api/music-shares" });
    expect((await app.inject({ method: "POST", url: "/api/music-shares", payload: { mediaIds: [4, 4] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/music-shares", payload: { mediaIds: Array.from({ length: 11 }, (_, index) => index + 1) } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/music-shares", payload: { mediaIds: [4], clipStarts: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/music-shares", payload: { mediaIds: [4], clipStarts: [-1] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/music-shares", payload: { mediaIds: [4] } })).statusCode).toBe(400);
    await app.close();
  });

  it("allows one accessible track without requiring it to be a favorite", async () => {
    const writes = [];
    const app = Fastify();
    app.decorate("redis", { async xadd() {} });
    app.decorate("pg", {
      async query(sql) {
        if (sql.includes("FROM requested")) {
          expect(sql).toContain("cardinality($3::int[]) = 1 OR l.media_id IS NOT NULL");
          return { rows: [{ id: 12, title: "Unliked Song", artists: "Artist", source_version: 1, duration: 42, position: 1, lyrics_segments: [{ start: 9 }] }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      async connect() {
        return {
          async query(sql, params) {
            writes.push({ sql, params });
            if (sql.includes("INSERT INTO music_share_reels")) return { rows: [{ id: 92, status: "queued", progress: 0, created_at: new Date(), expires_at: new Date() }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
          },
          release() {},
        };
      },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; request.clientIp = "127.0.0.1"; });
    await app.register(musicShareRoutes, { prefix: "/api/music-shares" });
    const response = await app.inject({ method: "POST", url: "/api/music-shares", payload: { mediaIds: [12], clipStarts: [40] } });
    expect(response.statusCode).toBe(202);
    const itemWrite = writes.find((entry) => entry.sql.includes("INSERT INTO music_share_reel_items"));
    expect(itemWrite.params[4]).toBe(32);
    await app.close();
  });

  it("rotates a ready reel link when the browser no longer has its raw secret", async () => {
    let updateParams;
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (sql.includes("SET token_hash = $2")) {
          updateParams = params;
          return { rows: [{ id: 93, status: "ready", progress: 100, track_count: 1, media_ids: [12], expires_at: new Date(), created_at: new Date(), updated_at: new Date() }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; request.clientIp = "127.0.0.1"; });
    await app.register(musicShareRoutes, { prefix: "/api/music-shares" });
    const response = await app.inject({ method: "POST", url: "/api/music-shares/current/link" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.mediaIds).toEqual([12]);
    expect(body.sharePath).toBe(`/shared/music#${body.token}`);
    expect(updateParams[1]).toBe(createHash("sha256").update(body.token).digest("hex"));
    expect(updateParams).not.toContain(body.token);
    await app.close();
  });
});
