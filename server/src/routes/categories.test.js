import Fastify from "fastify";
import { access, mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import categoriesRoutes from "./categories.js";

describe("category count aggregates", () => {
  it("keeps list and detail counts, zero values, and restricted-category behavior", async () => {
    const categories = [
      { id: 1, name: "Music", parent_id: null, min_access_tier: 0, path: "Music" },
      { id: 2, name: "Private", parent_id: 1, min_access_tier: 100, path: "Music / Private" },
      { id: 3, name: "Albums", parent_id: 1, min_access_tier: 0, path: "Music / Albums" },
      { id: 4, name: "Empty", parent_id: null, min_access_tier: 0, path: "Empty" },
    ];
    const mediaCategoryIds = [1, 1, 2, 3];
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (sql === "SELECT 1 FROM categories WHERE id = $1") {
          return { rowCount: Number(categories.some((category) => category.id === Number(params[0]))) };
        }
        expect(sql).toContain("LEFT JOIN (SELECT parent_id, COUNT(*)::int AS child_count FROM categories GROUP BY parent_id) cc");
        expect(sql).toContain("LEFT JOIN (SELECT category_id, COUNT(*)::int AS media_count FROM media_assets GROUP BY category_id) mc");
        expect(sql).toContain("COALESCE(cc.child_count, 0) AS child_count");
        expect(sql).toContain("COALESCE(mc.media_count, 0) AS media_count");
        expect(sql).not.toContain("(SELECT COUNT(*)::int FROM categories child");
        const rows = categories
          .filter((category) => category.min_access_tier <= params[0])
          .filter((category) => params.length === 1 || category.id === Number(params[1]))
          .map((category) => ({
            ...category,
            child_count: categories.filter((child) => child.parent_id === category.id).length,
            media_count: mediaCategoryIds.filter((id) => id === category.id).length,
          }));
        return { rows };
      },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 0; });
    await app.register(categoriesRoutes, { prefix: "/api/categories" });

    const list = await app.inject({ method: "GET", url: "/api/categories" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([
      { id: 1, name: "Music", parent_id: null, min_access_tier: 0, path: "Music", child_count: 2, media_count: 2 },
      { id: 3, name: "Albums", parent_id: 1, min_access_tier: 0, path: "Music / Albums", child_count: 0, media_count: 1 },
      { id: 4, name: "Empty", parent_id: null, min_access_tier: 0, path: "Empty", child_count: 0, media_count: 0 },
    ]);
    const detail = await app.inject({ method: "GET", url: "/api/categories/1" });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(list.json()[0]);
    const empty = await app.inject({ method: "GET", url: "/api/categories/4" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ child_count: 0, media_count: 0 });
    expect((await app.inject({ method: "GET", url: "/api/categories/2" })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/categories/99" })).statusCode).toBe(404);
    await app.close();
  });
});

describe("category covers", () => {
  it("serves the shared cover with cache validators and allows removing it", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-category-cover-"));
    await mkdir(join(dataDir, "7"), { recursive: true });
    await writeFile(join(dataDir, "7", "front.webp"), "shared-cover");
    const app = Fastify();
    app.decorate("pg", {
      async query(sql) {
        if (sql.includes("FROM category_tree WHERE id")) return { rows: [{ id: 7, cover_path: "7/front.webp" }], rowCount: 1 };
        if (sql.includes("SELECT id, cover_path FROM categories")) return { rows: [{ id: 7, cover_path: "7/front.webp" }], rowCount: 1 };
        return { rows: [{ id: 7 }], rowCount: 1 };
      },
    });
    app.addHook("onRequest", async (request) => { request.accessTier = 100; });
    await app.register(categoriesRoutes, { prefix: "/api/categories", dataDir });

    const first = await app.inject({ method: "GET", url: "/api/categories/7/thumbnail" });
    expect(first.statusCode).toBe(200);
    expect(first.body).toBe("shared-cover");
    expect(first.headers.etag).toBeTruthy();
    expect(first.headers["cache-control"]).toBe("private, no-cache, max-age=0, must-revalidate");
    const cached = await app.inject({ method: "GET", url: "/api/categories/7/thumbnail", headers: { "if-none-match": first.headers.etag } });
    expect(cached.statusCode).toBe(304);
    const deletion = await app.inject({ method: "DELETE", url: "/api/categories/7/thumbnail" });
    expect(deletion.statusCode).toBe(204);
    await expect(access(join(dataDir, "7", "front.webp"))).rejects.toThrow();

    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
});
