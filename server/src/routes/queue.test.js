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
    "orders %s by manual folder order, track order, and id",
    async (url) => {
      const sql = await autoQueueSql(url);
      expect(sql).toContain("ORDER BY ac.order_parts");
      expect(sql).toContain("COALESCE(m.track_order, 0)");
      expect(sql).not.toContain("lower(m.title)");
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
    expect(queries[0].sql).toContain("ORDER BY ac.order_parts");
    expect(queries[0].sql).toContain("COALESCE(m.track_order, 0)");
    expect(queries[0].sql).not.toContain("lower(m.title)");
    await app.close();
  });
});

describe("queue windows", () => {
  function windowRedis() {
    let queue = Array.from({ length: 250 }, (_, index) => String(index + 1));
    let currentIndex = 120;
    let revision = 7;
    return {
      async get(key) {
        if (key.startsWith("queue:index:")) return String(currentIndex);
        if (key.startsWith("queue:revision:")) return String(revision);
        return null;
      },
      async llen() { return queue.length; },
      async lindex(_key, index) { return queue[index] ?? null; },
      async lrange(_key, start, end) { return queue.slice(start, end < 0 ? queue.length : end + 1); },
      async incr() { revision += 1; return revision; },
      async set(key, value) { if (key.startsWith("queue:index:")) currentIndex = Number(value); return "OK"; },
      multi() {
        let nextQueue = [...queue];
        let nextIndex = currentIndex;
        const chain = {
          del(key) { if (key.startsWith("queue:index:")) nextIndex = 0; else nextQueue = []; return chain; },
          rpush(_key, ...ids) { nextQueue.push(...ids.map(String)); return chain; },
          set(_key, value) { nextIndex = Number(value); return chain; },
          async exec() { queue = nextQueue; currentIndex = nextIndex; return []; },
        };
        return chain;
      },
    };
  }

  it("hydrates at most 100 items around the active entry", async () => {
    const app = Fastify();
    app.decorate("redis", windowRedis());
    app.decorate("pg", {
      async query(_sql, params) {
        return { rows: params[1].map((id) => ({ id, title: `Media ${id}` })) };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(queueRoutes, { prefix: "/api/queue" });
    const response = await app.inject({ method: "GET", url: "/api/queue/window" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ offset: 70, total: 250, currentIndex: 120, currentMediaId: 121, revision: 7 });
    expect(response.json().items).toHaveLength(100);
    await app.close();
  });

  it("rejects a stale queue revision before reordering", async () => {
    const app = Fastify();
    app.decorate("redis", windowRedis());
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(queueRoutes, { prefix: "/api/queue" });
    const response = await app.inject({ method: "PUT", url: "/api/queue/window/order", payload: { offset: 0, mediaIds: [1, 2], revision: 6 } });
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it("reorders only the requested window and advances its revision", async () => {
    const app = Fastify();
    const redis = windowRedis();
    app.decorate("redis", redis);
    app.decorate("pg", {
      async query(_sql, params) { return { rows: params[1].map((id) => ({ id })) }; },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(queueRoutes, { prefix: "/api/queue" });
    const reordered = await app.inject({ method: "PUT", url: "/api/queue/window/order", payload: { offset: 70, mediaIds: [72, 71], revision: 7 } });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json()).toMatchObject({ total: 250, currentIndex: 120, currentMediaId: 121, revision: 8 });
    const refreshed = await app.inject({ method: "GET", url: "/api/queue/window?offset=70&limit=2" });
    expect(refreshed.json().items.map((item) => Number(item.id))).toEqual([72, 71]);
    await app.close();
  });
});
