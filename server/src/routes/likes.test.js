import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import likesRoutes from "./likes.js";

function buildApp(queryMock) {
  const app = Fastify();
  app.decorate("pg", { query: queryMock });
  app.addHook("onRequest", async (request) => {
    request.accessTier = 0;
    request.user = { id: 42 };
  });
  return app;
}

describe("likes routes - category favoriting", () => {
  it("reports fully liked, partly liked, and empty folder trees for the current account", async () => {
    const queries = [];
    const app = buildApp(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [
        { category_id: 7, total_audio_count: 3, liked_audio_count: 3 },
        { category_id: 8, total_audio_count: 2, liked_audio_count: 1 },
        { category_id: 9, total_audio_count: 0, liked_audio_count: 0 },
      ] };
    });
    await app.register(likesRoutes, { prefix: "/api/likes" });

    const response = await app.inject({ method: "GET", url: "/api/likes/category-status" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { categoryId: 7, totalAudioCount: 3, likedAudioCount: 3, fullyLiked: true },
      { categoryId: 8, totalAudioCount: 2, likedAudioCount: 1, fullyLiked: false },
      { categoryId: 9, totalAudioCount: 0, likedAudioCount: 0, fullyLiked: false },
    ]);
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([0, 42]);
    expect(queries[0].sql).toContain("JOIN accessible_categories c ON c.parent_id = d.category_id");
    expect(queries[0].sql).toContain("m.mime_type LIKE 'audio/%'");
    await app.close();
  });

  it("favorites all audio in a category and its descendants in a single recursive SQL query", async () => {
    const executedQueries = [];
    const app = buildApp(async (sql, params) => {
      executedQueries.push({ sql, params });
      if (sql.includes("SELECT id, name FROM categories")) {
        return { rowCount: 1, rows: [{ id: 7, name: "Rock" }] };
      }
      if (sql.includes("WITH RECURSIVE folder_tree AS")) {
        return {
          rowCount: 1,
          rows: [{ total_count: 5, added_count: 3, added_ids: [10, 11, 12] }],
        };
      }
      return { rowCount: 0, rows: [] };
    });

    await app.register(likesRoutes, { prefix: "/api/likes" });

    const response = await app.inject({
      method: "PUT",
      url: "/api/likes/category/7",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({
      ok: true,
      categoryId: 7,
      categoryName: "Rock",
      totalCount: 5,
      addedCount: 3,
      addedIds: [10, 11, 12],
    });

    // Verify exactly 2 queries total: 1 existence check + 1 single recursive insert (no N+1!)
    expect(executedQueries.length).toBe(2);

    const recursiveQuery = executedQueries[1];
    expect(recursiveQuery.sql).toContain("WITH RECURSIVE folder_tree AS");
    expect(recursiveQuery.sql).toContain("JOIN folder_tree ft ON c.parent_id = ft.id");
    expect(recursiveQuery.sql).toContain("WHERE m.mime_type LIKE 'audio/%'");
    expect(recursiveQuery.sql).toContain("ON CONFLICT (user_id, media_id) DO NOTHING");
    expect(recursiveQuery.params).toEqual([7, 0, 42]);

    await app.close();
  });

  it("supports alias /api/likes/folder/:categoryId with POST method", async () => {
    const app = buildApp(async (sql) => {
      if (sql.includes("SELECT id, name FROM categories")) {
        return { rowCount: 1, rows: [{ id: 9, name: "Jazz" }] };
      }
      return {
        rowCount: 1,
        rows: [{ total_count: 2, added_count: 2, added_ids: [21, 22] }],
      };
    });

    await app.register(likesRoutes, { prefix: "/api/likes" });

    const response = await app.inject({
      method: "POST",
      url: "/api/likes/folder/9",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      categoryId: 9,
      categoryName: "Jazz",
      totalCount: 2,
      addedCount: 2,
    });

    await app.close();
  });

  it("unfavorites all audio in a category and its descendants in a single recursive SQL query", async () => {
    const executedQueries = [];
    const app = buildApp(async (sql, params) => {
      executedQueries.push({ sql, params });
      if (sql.includes("SELECT id, name FROM categories")) {
        return { rowCount: 1, rows: [{ id: 7, name: "Rock" }] };
      }
      if (sql.includes("DELETE FROM liked_music")) {
        return {
          rowCount: 1,
          rows: [{ removed_count: 3, removed_ids: [10, 11, 12] }],
        };
      }
      return { rowCount: 0, rows: [] };
    });

    await app.register(likesRoutes, { prefix: "/api/likes" });

    const response = await app.inject({
      method: "DELETE",
      url: "/api/likes/category/7",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      categoryId: 7,
      categoryName: "Rock",
      removedCount: 3,
      removedIds: [10, 11, 12],
    });

    expect(executedQueries.length).toBe(2);
    const deleteQuery = executedQueries[1];
    expect(deleteQuery.sql).toContain("WITH RECURSIVE folder_tree AS");
    expect(deleteQuery.sql).toContain("DELETE FROM liked_music");
    expect(deleteQuery.sql).toContain("WHERE m.mime_type LIKE 'audio/%'");
    expect(deleteQuery.params).toEqual([7, 0, 42]);

    await app.close();
  });

  it("returns 400 for invalid category ID", async () => {
    const app = buildApp(async () => ({ rowCount: 0, rows: [] }));
    await app.register(likesRoutes, { prefix: "/api/likes" });

    const response = await app.inject({
      method: "PUT",
      url: "/api/likes/category/not-a-number",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Invalid category ID");

    await app.close();
  });

  it("returns 404 when category does not exist or is inaccessible", async () => {
    const app = buildApp(async (sql) => {
      if (sql.includes("SELECT id, name FROM categories")) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });
    await app.register(likesRoutes, { prefix: "/api/likes" });

    const response = await app.inject({
      method: "PUT",
      url: "/api/likes/category/999",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("Category not found");

    await app.close();
  });
});
