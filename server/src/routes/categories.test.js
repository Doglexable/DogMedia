import Fastify from "fastify";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import categoriesRoutes from "./categories.js";

describe("category covers", () => {
  it("serves the shared cover with cache validators and prevents deleting a required child cover", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-category-cover-"));
    await mkdir(join(dataDir, "7"), { recursive: true });
    await writeFile(join(dataDir, "7", "front.webp"), "shared-cover");
    const app = Fastify();
    app.decorate("pg", {
      async query(sql) {
        if (sql.includes("FROM category_tree WHERE id")) return { rows: [{ id: 7, cover_path: "7/front.webp" }], rowCount: 1 };
        if (sql.includes("EXISTS (SELECT 1 FROM media_assets")) {
          return { rows: [{ id: 7, parent_id: 1, cover_path: "7/front.webp", has_media: true }], rowCount: 1 };
        }
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
    expect(deletion.statusCode).toBe(409);

    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
});
