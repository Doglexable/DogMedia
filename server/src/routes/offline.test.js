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
    mime_type: "audio/mpeg", file_path: "7/1.mp3", has_lyrics: true, liked: true,
  };
}

async function buildApp(dataDir) {
  const app = Fastify();
  const queries = [];
  app.decorate("pg", {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("FROM media_assets m")) {
        const ids = Array.isArray(params.at(-1)) ? params.at(-1) : null;
        return { rows: ids && !ids.includes(1) ? [] : [mediaRow()], rowCount: 1 };
      }
      if (sql.includes("SELECT id FROM media_assets")) return { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
      if (sql.includes("SELECT 1 FROM media_assets")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  });
  app.decorate("redis", { get: async () => null, set: async () => "OK", del: async () => 1, zadd: async () => 1 });
  app.addHook("onRequest", async (request) => {
    request.accessTier = 0;
    request.clientIp = "127.0.0.1";
  });
  await app.register(offlineRoutes, { prefix: "/api/offline", dataDir });
  return { app, queries };
}

describe("offline routes", () => {
  it("returns an audio-only direct-folder manifest with version metadata", async () => {
    const { app, queries } = await buildApp(await fixture());
    const response = await app.inject({ method: "GET", url: "/api/offline/manifest?category_id=7" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({ id: 1, category_id: 7, byteSize: 13, hasLyrics: true, liked: true });
    expect(response.json().items[0].fileVersion).toMatch(/^13:\d+$/);
    expect(queries[0].sql).toContain("m.mime_type LIKE 'audio/%'");
    expect(queries[0].sql).toContain("m.category_id = $3");
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
});
