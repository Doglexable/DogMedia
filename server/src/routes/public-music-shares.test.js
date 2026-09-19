import Fastify from "fastify";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import publicMusicShareRoutes from "./public-music-shares.js";

function memoryRedis() {
  const values = new Map();
  return {
    async get(key) { return values.get(key) || null; },
    async set(key, value) { values.set(key, value); return "OK"; },
    async incr(key) { const next = Number(values.get(key) || 0) + 1; values.set(key, next); return next; },
    async expire() { return 1; },
  };
}

describe("public music reels", () => {
  it("exchanges a ready reel secret for a temporary video session and streams ranges", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-public-reel-"));
    await mkdir(join(dataDir, "shares", "music-reels"), { recursive: true });
    await writeFile(join(dataDir, "shares", "music-reels", "9.mp4"), "shared-reel-video");
    const app = Fastify();
    app.decorate("redis", memoryRedis());
    app.decorate("pg", {
      async query(sql) {
        if (sql.includes("r.token_hash = $1")) return { rows: [{
          id: 9, status: "ready", progress: 100, output_path: "shares/music-reels/9.mp4",
          duration_seconds: 20, expires_at: new Date(Date.now() + 86_400_000),
          tracks: [{ position: 1, title: "Night Drive", artists: "The Dogs" }, { position: 2, title: "Blue Hour", artists: "The Dogs" }],
        }], rowCount: 1 };
        if (sql.includes("WHERE id = $1 AND status = 'ready'")) {
          return { rows: [{ output_path: "shares/music-reels/9.mp4" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    await app.register(publicMusicShareRoutes, { prefix: "/api/public", dataDir });
    const exchange = await app.inject({ method: "POST", url: "/api/public/music/session", payload: { token: "a".repeat(43) } });
    expect(exchange.statusCode).toBe(200);
    expect(exchange.json()).toMatchObject({ status: "ready", duration: 20 });
    expect(exchange.json().streamUrl).not.toContain("a".repeat(43));
    expect(exchange.json().downloadUrl).not.toContain("a".repeat(43));
    const stream = await app.inject({ method: "GET", url: exchange.json().streamUrl, headers: { range: "bytes=0-5" } });
    expect(stream.statusCode).toBe(206);
    expect(stream.body).toBe("shared");
    expect(stream.headers["content-range"]).toBe("bytes 0-5/17");
    const download = await app.inject({ method: "GET", url: exchange.json().downloadUrl });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-disposition"]).toBe('attachment; filename="dogmedia-favorite-reel.mp4"');
    expect(download.body).toBe("shared-reel-video");
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("reports render progress before a reel is ready", async () => {
    const app = Fastify();
    app.decorate("redis", memoryRedis());
    app.decorate("pg", { query: async () => ({ rows: [{
      id: 9, status: "processing", progress: 40, output_path: null, duration_seconds: null,
      expires_at: new Date(Date.now() + 86_400_000), tracks: [{ position: 1, title: "Night Drive" }],
    }], rowCount: 1 }) });
    await app.register(publicMusicShareRoutes, { prefix: "/api/public" });
    const response = await app.inject({ method: "POST", url: "/api/public/music/session", payload: { token: "b".repeat(43) } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: "processing", progress: 40, duration: 10 });
    expect(response.json().streamUrl).toBeUndefined();
    await app.close();
  });

  it("returns the same not-found response for malformed and unknown secrets", async () => {
    const app = Fastify();
    app.decorate("redis", memoryRedis());
    app.decorate("pg", { query: async () => ({ rows: [], rowCount: 0 }) });
    await app.register(publicMusicShareRoutes, { prefix: "/api/public" });
    const malformed = await app.inject({ method: "POST", url: "/api/public/music/session", payload: { token: "short" } });
    const unknown = await app.inject({ method: "POST", url: "/api/public/music/session", payload: { token: "z".repeat(43) } });
    expect(malformed.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(malformed.json()).toEqual(unknown.json());
    await app.close();
  });
});
