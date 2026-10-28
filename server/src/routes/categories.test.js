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

async function accessFixture(tier = 100) {
  const dataDir = await mkdtemp(join(tmpdir(), "pfs-category-access-"));
  await mkdir(join(dataDir, "2"), { recursive: true });
  await writeFile(join(dataDir, "2", "front.webp"), "private-cover");
  const categories = new Map([
    [1, { id: 1, name: "Open", parent_id: null, min_access_tier: 0, sort_order: 0, cover_path: null }],
    [2, { id: 2, name: "Private root", parent_id: null, min_access_tier: 999, sort_order: 1, cover_path: "2/front.webp" }],
    [3, { id: 3, name: "Open child", parent_id: 1, min_access_tier: 0, sort_order: 0, cover_path: null }],
    [4, { id: 4, name: "Private child", parent_id: 1, min_access_tier: 999, sort_order: 1, cover_path: null }],
    [5, { id: 5, name: "Public under private", parent_id: 4, min_access_tier: 0, sort_order: 0, cover_path: null }],
  ]);
  const writes = [];
  const accessible = (id, accessTier) => {
    const category = categories.get(Number(id));
    return category && category.min_access_tier <= accessTier ? category : null;
  };
  const query = async (sql, params = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK", "LOCK TABLE categories IN SHARE ROW EXCLUSIVE MODE"].includes(normalized)) return { rows: [], rowCount: 0 };
    if (normalized.includes("FROM category_tree WHERE id = $2")) {
      const category = accessible(params[1], params[0]);
      return { rows: category ? [{ ...category }] : [], rowCount: Number(Boolean(category)) };
    }
    if (normalized === "SELECT 1 FROM categories WHERE id = $1") {
      return { rows: [], rowCount: Number(categories.has(Number(params[0]))) };
    }
    if (normalized.includes("SELECT 1 FROM categories WHERE parent_id = $1 LIMIT 1")) {
      return { rows: [], rowCount: Number([...categories.values()].some((category) => category.parent_id === Number(params[0]))) };
    }
    if (normalized.includes("SELECT 1 FROM descendants WHERE id = $2 LIMIT 1")) {
      let category = categories.get(Number(params[1]));
      while (category?.parent_id != null) {
        if (category.parent_id === Number(params[0])) return { rows: [{}], rowCount: 1 };
        category = categories.get(category.parent_id);
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.includes("SELECT 1 FROM descendants WHERE min_access_tier > $2 LIMIT 1")) {
      const rootId = Number(params[0]);
      const pending = [rootId];
      while (pending.length) {
        const parentId = pending.pop();
        for (const category of categories.values()) {
          if (category.parent_id !== parentId) continue;
          if (category.min_access_tier > params[1]) return { rows: [{}], rowCount: 1 };
          pending.push(category.id);
        }
      }
      return { rows: [], rowCount: 0 };
    }
    if (normalized.includes("SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order")) {
      return { rows: [{ next_order: 2 }], rowCount: 1 };
    }
    if (normalized.includes("SELECT id FROM categories WHERE parent_id IS NOT DISTINCT FROM")) {
      const parents = normalized.includes("OR parent_id IS NOT DISTINCT FROM $2") ? params : [params[0]];
      const excludedId = normalized.includes("AND id <> $2") ? Number(params[1]) : null;
      const rows = [...categories.values()]
        .filter((category) => parents.includes(category.parent_id) && category.id !== excludedId)
        .map(({ id }) => ({ id }));
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("INSERT INTO categories")) {
      writes.push({ sql: normalized, params });
      const category = { id: 6, name: params[0], parent_id: params[3], min_access_tier: params[2], sort_order: 0, cover_path: null };
      categories.set(6, category);
      return { rows: [{ ...category }], rowCount: 1 };
    }
    if (normalized.includes("UPDATE categories SET min_access_tier = $2")) {
      writes.push({ sql: normalized, params });
      const pending = [Number(params[0])];
      let count = 0;
      while (pending.length) {
        const parentId = pending.pop();
        for (const category of categories.values()) {
          if (category.parent_id !== parentId) continue;
          category.min_access_tier = params[1];
          pending.push(category.id);
          count += 1;
        }
      }
      return { rows: [], rowCount: count };
    }
    if (normalized.startsWith("UPDATE categories")) {
      writes.push({ sql: normalized, params });
      const id = Number(params.at(-1));
      const category = categories.get(id);
      if (category && normalized.startsWith("UPDATE categories SET name")) {
        category.name = params[0] ?? category.name;
        category.parent_id = params[3];
        category.min_access_tier = params[2];
      }
      if (category && normalized.startsWith("UPDATE categories SET parent_id")) {
        category.parent_id = params[0];
      }
      return { rows: category ? [{ ...category }] : [], rowCount: Number(Boolean(category)) };
    }
    if (normalized.startsWith("DELETE FROM categories")) {
      writes.push({ sql: normalized, params });
      const category = categories.get(Number(params[0]));
      categories.delete(Number(params[0]));
      return { rows: category ? [{ cover_path: category.cover_path }] : [], rowCount: Number(Boolean(category)) };
    }
    if (normalized.includes("FROM categories WHERE id = $1")) {
      const category = categories.get(Number(params[0]));
      return { rows: category ? [{ ...category }] : [], rowCount: Number(Boolean(category)) };
    }
    throw new Error(`Unexpected category query: ${normalized}`);
  };
  const app = Fastify();
  app.decorate("pg", { query, async connect() { return { query, release() {} }; } });
  app.addHook("onRequest", async (request) => { request.accessTier = tier; });
  await app.register(categoriesRoutes, { prefix: "/api/categories", dataDir });
  return { app, categories, dataDir, writes, async close() { await app.close(); await rm(dataDir, { recursive: true, force: true }); } };
}

describe("category mutation access", () => {
  it.each([
    ["POST", "/api/categories", { name: "Under private", parent_id: 2 }],
    ["POST", "/api/categories", { name: "Under private child", parent_id: 4 }],
    ["PUT", "/api/categories/2", { name: "Exposed", min_access_tier: 0 }],
    ["PUT", "/api/categories/3", { name: "Moved", parent_id: 2 }],
    ["DELETE", "/api/categories/2", undefined],
    ["PUT", "/api/categories/2/thumbnail", undefined],
    ["DELETE", "/api/categories/2/thumbnail", undefined],
    ["PATCH", "/api/categories/2/move", { parentId: 1, index: 0 }],
    ["PATCH", "/api/categories/3/move", { parentId: 2, index: 0 }],
    ["PATCH", "/api/categories/3/move", { parentId: 4, index: 0 }],
  ])("rejects %s %s for tier 100 without writes or file deletion", async (method, url, payload) => {
    const fixture = await accessFixture();
    try {
      const response = await fixture.app.inject({ method, url, ...(payload ? { payload } : {}) });
      expect(response.statusCode).toBe(403);
      expect(fixture.writes).toEqual([]);
      expect(fixture.categories.get(2)?.min_access_tier).toBe(999);
      expect(await access(join(fixture.dataDir, "2", "front.webp"))).toBeUndefined();
    } finally {
      await fixture.close();
    }
  });

  it("keeps missing targets as 404 and permits tier 999 edits and moves", async () => {
    const fixture = await accessFixture(999);
    try {
      const missing = await fixture.app.inject({ method: "PUT", url: "/api/categories/99", payload: { name: "Missing" } });
      expect(missing.statusCode).toBe(404);
      const edit = await fixture.app.inject({ method: "PUT", url: "/api/categories/2", payload: { name: "Renamed" } });
      expect(edit.statusCode).toBe(200);
      expect(edit.json().name).toBe("Renamed");
      const move = await fixture.app.inject({ method: "PATCH", url: "/api/categories/3/move", payload: { parentId: 2, index: 0 } });
      expect(move.statusCode).toBe(200);
      expect(move.json().parent_id).toBe(2);
      expect(move.json().min_access_tier).toBe(0);
      expect(fixture.writes.length).toBeGreaterThan(0);
    } finally {
      await fixture.close();
    }
  });

  it("allows tier 100 to create under and edit a visible category", async () => {
    const fixture = await accessFixture();
    try {
      const created = await fixture.app.inject({ method: "POST", url: "/api/categories", payload: { name: "New", parent_id: 1 } });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ parent_id: 1, min_access_tier: 0 });
      const edited = await fixture.app.inject({ method: "PUT", url: "/api/categories/3", payload: { name: "Renamed open child" } });
      expect(edited.statusCode).toBe(200);
      expect(edited.json().name).toBe("Renamed open child");
      expect(fixture.writes).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });

  it("lets an administrator make a branch public while its parent stays private", async () => {
    const fixture = await accessFixture(999);
    try {
      const created = await fixture.app.inject({ method: "POST", url: "/api/categories", payload: { name: "Public branch", parent_id: 2, min_access_tier: 0 } });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ parent_id: 2, min_access_tier: 0 });
      expect(fixture.categories.get(2).min_access_tier).toBe(999);

      const edited = await fixture.app.inject({ method: "PUT", url: "/api/categories/2", payload: { min_access_tier: 100 } });
      expect(edited.statusCode).toBe(200);
      expect(fixture.categories.get(2).min_access_tier).toBe(100);
      expect(fixture.categories.get(6).min_access_tier).toBe(0);
      expect(fixture.categories.get(5).min_access_tier).toBe(0);
      expect(fixture.writes).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });

  it("lets an admin edit a public branch below a restricted parent without changing its parent", async () => {
    const fixture = await accessFixture(100);
    try {
      const response = await fixture.app.inject({ method: "PUT", url: "/api/categories/5", payload: { name: "Renamed public branch", parent_id: 4, min_access_tier: 0 } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ name: "Renamed public branch", parent_id: 4, min_access_tier: 0 });
      expect(fixture.categories.get(4).min_access_tier).toBe(999);
    } finally {
      await fixture.close();
    }
  });

  it("applies a folder tier to every descendant only when requested", async () => {
    const fixture = await accessFixture(999);
    try {
      const response = await fixture.app.inject({ method: "PUT", url: "/api/categories/1", payload: { min_access_tier: 100, apply_to_children: true } });
      expect(response.statusCode).toBe(200);
      expect([1, 3, 4, 5].map((id) => fixture.categories.get(id).min_access_tier)).toEqual([100, 100, 100, 100]);
      expect(fixture.categories.get(2).min_access_tier).toBe(999);
      expect(fixture.writes).toHaveLength(2);
    } finally {
      await fixture.close();
    }
  });

  it("rejects tier propagation if a child is above the admin's access tier", async () => {
    const fixture = await accessFixture(100);
    try {
      const response = await fixture.app.inject({ method: "PUT", url: "/api/categories/1", payload: { min_access_tier: 100, apply_to_children: true } });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "Access denied to a child category" });
      expect(fixture.writes).toEqual([]);
      expect(fixture.categories.get(1).min_access_tier).toBe(0);
      expect(fixture.categories.get(4).min_access_tier).toBe(999);
    } finally {
      await fixture.close();
    }
  });
});
