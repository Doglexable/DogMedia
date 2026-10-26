import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import lyricsRoutes from "./lyrics.js";

const VALID_LYRICS = {
  language: "en",
  segments: [{ start: 0, end: 2, text: "First line" }],
};

async function buildApp(accessTier) {
  const categories = new Map([
    [1, { parentId: null, minTier: 0 }],
    [2, { parentId: 1, minTier: 999 }],
    [3, { parentId: 2, minTier: 0 }],
  ]);
  const media = new Map([[10, 1], [20, 2], [30, 3]]);
  const lyrics = new Map([[10, VALID_LYRICS], [20, VALID_LYRICS], [30, VALID_LYRICS]]);
  const mutations = [];

  function isAccessible(mediaId) {
    let categoryId = media.get(Number(mediaId));
    if (!categoryId) return false;
    while (categoryId !== null) {
      const category = categories.get(categoryId);
      if (!category || category.minTier > accessTier) return false;
      categoryId = category.parentId;
    }
    return true;
  }

  const app = Fastify();
  app.decorate("pg", {
    async query(sql, params) {
      if (sql.includes("WITH RECURSIVE accessible_categories")) {
        const mediaId = Number(params[1]);
        const item = lyrics.get(mediaId);
        const rows = isAccessible(mediaId)
          ? [{ media_id: mediaId, language: item?.language || null, segments: item?.segments || null, updated_at: "2026-10-26T00:00:00.000Z" }]
          : [];
        return { rows, rowCount: rows.length };
      }
      if (sql === "SELECT 1 FROM media_assets WHERE id = $1") {
        return { rows: media.has(Number(params[0])) ? [{}] : [], rowCount: Number(media.has(Number(params[0]))) };
      }
      if (sql.startsWith("INSERT INTO media_lyrics")) {
        mutations.push({ sql, params });
        const mediaId = Number(params[0]);
        const item = { language: params[1], segments: JSON.parse(params[2]) };
        lyrics.set(mediaId, item);
        return { rows: [{ media_id: mediaId, ...item, updated_at: "2026-10-26T00:00:00.000Z" }], rowCount: 1 };
      }
      if (sql === "DELETE FROM media_lyrics WHERE media_id = $1") {
        mutations.push({ sql, params });
        return { rows: [], rowCount: Number(lyrics.delete(Number(params[0]))) };
      }
      throw new Error(`Unexpected lyrics query: ${sql}`);
    },
  });
  app.addHook("onRequest", async (request) => { request.accessTier = accessTier; });
  await app.register(lyricsRoutes, { prefix: "/api" });
  return { app, lyrics, mutations };
}

describe("lyrics mutation access", () => {
  it.each(["PUT", "DELETE"])("rejects %s for a standard user without mutation", async (method) => {
    const { app, mutations } = await buildApp(0);
    try {
      const response = await app.inject({ method, url: "/api/media/10/lyrics", ...(method === "PUT" ? { payload: VALID_LYRICS } : {}) });
      expect(response.statusCode).toBe(403);
      expect(mutations).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it.each(["PUT", "DELETE"])("rejects %s for media above the admin's tier and below a hidden ancestor", async (method) => {
    const { app, lyrics, mutations } = await buildApp(100);
    try {
      for (const mediaId of [20, 30]) {
        const response = await app.inject({ method, url: `/api/media/${mediaId}/lyrics`, ...(method === "PUT" ? { payload: VALID_LYRICS } : {}) });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ error: "Access denied" });
      }
      expect(mutations).toEqual([]);
      expect(lyrics.has(20)).toBe(true);
      expect(lyrics.has(30)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it.each(["PUT", "DELETE"])("returns 404 for %s of missing media", async (method) => {
    const { app, mutations } = await buildApp(999);
    try {
      const response = await app.inject({ method, url: "/api/media/99/lyrics", ...(method === "PUT" ? { payload: VALID_LYRICS } : {}) });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "Media not found" });
      expect(mutations).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("lets tier 999 upload and delete lyrics on tier 999 media", async () => {
    const { app, lyrics, mutations } = await buildApp(999);
    try {
      const put = await app.inject({ method: "PUT", url: "/api/media/20/lyrics", payload: VALID_LYRICS });
      expect(put.statusCode).toBe(200);
      expect(put.json()).toMatchObject({ mediaId: 20, language: "en", segments: VALID_LYRICS.segments });
      const removal = await app.inject({ method: "DELETE", url: "/api/media/20/lyrics" });
      expect(removal.statusCode).toBe(204);
      expect(lyrics.has(20)).toBe(false);
      expect(mutations).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("keeps 404 for accessible media without lyrics and 400 for invalid uploads", async () => {
    const { app, lyrics, mutations } = await buildApp(100);
    try {
      lyrics.delete(10);
      const removal = await app.inject({ method: "DELETE", url: "/api/media/10/lyrics" });
      expect(removal.statusCode).toBe(404);
      expect(removal.json()).toEqual({ error: "Lyrics not found" });
      const upload = await app.inject({ method: "PUT", url: "/api/media/10/lyrics", payload: { segments: [] } });
      expect(upload.statusCode).toBe(400);
      expect(mutations).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
