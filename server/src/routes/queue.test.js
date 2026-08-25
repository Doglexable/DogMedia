import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import queueRoutes from "./queue.js";

function redisMock() {
  return {
    multi() {
      const chain = {
        del: () => chain,
        rpush: () => chain,
        set: () => chain,
        exec: async () => [],
      };
      return chain;
    },
  };
}

async function autoQueueSql(url) {
  const queries = [];
  const app = Fastify();
  app.decorate("pg", {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes("WITH ORDINALITY")) return { rows: [] };
      return { rows: [{ id: 8 }, { id: 9 }] };
    },
  });
  app.decorate("redis", redisMock());
  app.addHook("onRequest", async (request) => {
    request.accessTier = 0;
    request.clientIp = "127.0.0.1";
  });
  await app.register(queueRoutes, { prefix: "/api/queue" });
  const response = await app.inject({ method: "POST", url });
  expect(response.statusCode).toBe(200);
  await app.close();
  return queries[0].sql;
}

describe("automatic queue ordering", () => {
  it.each(["/api/queue/auto/7?start=8", "/api/queue/auto?start=8"])(
    "orders %s by folder path, track order, title, and id",
    async (url) => {
      const sql = await autoQueueSql(url);
      expect(sql).toContain("lower(array_to_string(ac.path_parts, ' / '))");
      expect(sql).toContain("m.track_order ASC NULLS LAST");
      expect(sql).toContain("lower(m.title)");
      expect(sql).toContain("m.id");
    }
  );
});

describe("category queue append", () => {
  it("appends accessible audio in track order without duplicating queued media", async () => {
    let queue = [99, 2];
    let currentIndex = 0;
    const queries = [];
    const redis = {
      async lrange() { return queue.map(String); },
      async get() { return String(currentIndex); },
      multi() {
        let nextQueue = [...queue];
        let nextIndex = currentIndex;
        const chain = {
          del(key) {
            if (key.startsWith("queue:index:")) nextIndex = 0;
            else nextQueue = [];
            return chain;
          },
          rpush(_key, ...ids) { nextQueue.push(...ids.map(Number)); return chain; },
          set(_key, index) { nextIndex = Number(index); return chain; },
          async exec() { queue = nextQueue; currentIndex = nextIndex; return []; },
        };
        return chain;
      },
    };
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.includes("WITH ORDINALITY")) {
          return { rows: params[1].map((id) => ({ id })) };
        }
        return { rows: [{ id: 4 }, { id: 2 }, { id: 3 }] };
      },
    });
    app.decorate("redis", redis);
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(queueRoutes, { prefix: "/api/queue" });

    const response = await app.inject({ method: "POST", url: "/api/queue/items/category/7" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      queue: [99, 2, 4, 3],
      currentIndex: 0,
      addedCount: 2,
    });
    expect(queries[0].sql).toContain("m.mime_type LIKE 'audio/%'");
    expect(queries[0].sql).toContain("m.track_order ASC NULLS LAST");
    expect(queries[0].sql).toContain("lower(m.title)");
    await app.close();
  });
});
