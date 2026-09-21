import Fastify from "fastify";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import offlineRoutes from "./offline.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "pfs-offline-route-"));
  tempDirs.push(dataDir);
  await mkdir(join(dataDir, "7"));
  await writeFile(join(dataDir, "7/1.mp3"), "offline-audio");
  return dataDir;
}

function mediaRow() {
  return {
    id: 1, category_id: 7, category_name: "Folder", category_path: "Folder",
    title: "Track", description: null, artists: "Artist", duration: 30,
    track_order: 3, mime_type: "audio/mpeg", file_path: "7/1.mp3", has_lyrics: true, liked: true,
  };
}

async function buildApp(dataDir) {
  const app = Fastify();
  const queries = [];
  const redisCommands = [];
  app.decorate("pg", {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM media_assets m")) {
        const ids = Array.isArray(params.at(-1)) ? params.at(-1) : null;
        return { rows: ids && !ids.includes(1) ? [] : [mediaRow()], rowCount: 1 };
      }
      if (sql.includes("SELECT id FROM media_assets")) return { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
      if (sql.includes("SELECT 1 FROM media_assets")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (sql.includes("INSERT INTO playback_events")) {
        return { rows: JSON.parse(params[0]).map((event) => ({ client_event_id: event.client_event_id })), rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  });
  app.decorate("redis", {
    get: async () => null,
    set: async () => "OK",
    del: async () => 1,
    zadd: async () => 1,
    multi() {
      const chain = {};
      for (const command of ["del", "set", "zadd"]) {
        chain[command] = (...args) => { redisCommands.push([command, ...args]); return chain; };
      }
      chain.exec = async () => [];
      return chain;
    },
  });
  app.addHook("onRequest", async (request) => {
    request.accessTier = 0;
    request.clientIp = "127.0.0.1";
  });
  await app.register(offlineRoutes, { prefix: "/api/offline", dataDir });
  return { app, queries, redisCommands };
}

describe("offline routes", () => {
  it("returns an audio-only direct-folder manifest with version metadata", async () => {
    const { app, queries } = await buildApp(await fixture());
    const response = await app.inject({ method: "GET", url: "/api/offline/manifest?category_id=7" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({ id: 1, category_id: 7, track_order: 3, byteSize: 13, hasLyrics: true, liked: true });
    expect(response.json().items[0].fileVersion).toMatch(/^13:\d+$/);
    expect(queries[0].sql).toContain("m.mime_type LIKE 'audio/%'");
    expect(queries[0].sql).toContain("m.offline_allowed = TRUE");
    expect(queries[0].sql).toContain("m.category_id = $3");
    expect(queries[0].sql).toContain("ORDER BY ac.order_parts");
    expect(queries[0].sql).toContain("COALESCE(m.track_order, 0)");
    expect(queries[0].sql).not.toContain("lower(m.title)");
    expect(queries[0].params).toEqual([0, "127.0.0.1", 7]);
    await app.close();
  });

  it("classifies valid, locked, missing, and changed downloads", async () => {
    const { app } = await buildApp(await fixture());
    const manifest = await app.inject({ method: "GET", url: "/api/offline/manifest?media_id=1" });
    const version = manifest.json().items[0].fileVersion;
    const response = await app.inject({
      method: "POST",
      url: "/api/offline/validate",
      payload: { items: [
        { mediaId: 1, fileVersion: version },
        { mediaId: 1, fileVersion: "old" },
        { mediaId: 2, fileVersion: "x" },
        { mediaId: 3, fileVersion: "x" },
      ] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item) => item.status)).toEqual(["valid", "changed", "locked", "missing"]);
    await app.close();
  });

  it("enforces the validation batch limit", async () => {
    const { app } = await buildApp(await fixture());
    const response = await app.inject({ method: "POST", url: "/api/offline/validate", payload: { items: Array.from({ length: 501 }, (_, index) => ({ mediaId: index + 1 })) } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("writes offline events in one database batch and pipelines Redis updates", async () => {
    const { app, queries, redisCommands } = await buildApp(await fixture());
    const clientEventId = "123e4567-e89b-42d3-a456-426614174000";
    const response = await app.inject({
      method: "POST",
      url: "/api/offline/sync",
      payload: {
        events: [{ clientEventId, mediaId: 1, action: "play", position: 3, duration: 30, title: "Track", occurredAt: "2026-01-02T03:04:05.000Z" }],
        resumes: [{ mediaId: 1, position: 9, duration: 30, updatedAt: "2026-01-02T03:05:05.000Z" }],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      acceptedEventIds: [clientEventId],
      rejectedEventIds: [],
      acceptedResumeIds: [1],
      rejectedResumeIds: [],
    });
    expect(queries.filter(({ sql }) => sql.includes("INSERT INTO playback_events"))).toHaveLength(1);
    expect(redisCommands.map(([command]) => command)).toEqual(["zadd", "set"]);
    await app.close();
  });

  it("reports rejected events and resumes when media is deleted or inaccessible", async () => {
    const { app, queries } = await buildApp(await fixture());
    const validEventId = "123e4567-e89b-42d3-a456-426614174000";
    const rejectedEventId = "223e4567-e89b-42d3-a456-426614174001";
    const response = await app.inject({
      method: "POST",
      url: "/api/offline/sync",
      payload: {
        events: [
          { clientEventId: validEventId, mediaId: 1, action: "play", position: 3, duration: 30, title: "Track", occurredAt: "2026-01-02T03:04:05.000Z" },
          { clientEventId: rejectedEventId, mediaId: 999, action: "play", position: 5, duration: 20, title: "Deleted", occurredAt: "2026-01-02T03:04:06.000Z" },
        ],
        resumes: [
          { mediaId: 1, position: 9, duration: 30, updatedAt: "2026-01-02T03:05:05.000Z" },
          { mediaId: 999, position: 5, duration: 20, updatedAt: "2026-01-02T03:05:06.000Z" },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      acceptedEventIds: [validEventId],
      rejectedEventIds: [rejectedEventId],
      acceptedResumeIds: [1],
      rejectedResumeIds: [999],
    });
    const insertQueries = queries.filter(({ sql }) => sql.includes("INSERT INTO playback_events"));
    expect(insertQueries).toHaveLength(1);
    const insertedPayload = JSON.parse(insertQueries[0].params[0]);
    expect(insertedPayload).toHaveLength(1);
    expect(insertedPayload[0].client_event_id).toBe(validEventId);
    await app.close();
  });
});
