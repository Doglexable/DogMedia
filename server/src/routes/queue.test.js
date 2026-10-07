import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import queueRoutes from "./queue.js";

function redisMock() {
  return {
    multi() {
      const chain = {
        del: () => chain,
        rpush: () => chain,
        set: () => chain,
        expire: () => chain,
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

  it("orders /api/queue/auto/likes by liked_at DESC and filters by client_ip", async () => {
    const sql = await autoQueueSql("/api/queue/auto/likes?start=8");
    expect(sql).toContain("FROM liked_music l");
    expect(sql).toContain("ORDER BY l.liked_at DESC");
    expect(sql).toContain("l.client_ip = $2::inet");
  });
});

describe("automatic queue category validation", () => {
  it("rejects malformed category ids before querying the database", async () => {
    const query = vi.fn();
    const app = Fastify();
    app.decorate("pg", { query });
    app.addHook("onRequest", async (request) => { request.accessTier = 0; });
    await app.register(queueRoutes, { prefix: "/api/queue" });
    for (const categoryId of ["abc", "7abc", "0", "2147483648"]) {
      const response = await app.inject({ method: "POST", url: `/api/queue/auto/${categoryId}` });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "Invalid category id" });
    }
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("playlist completion suggestions", () => {
  it("returns the next playable sibling without touching Redis", async () => {
    const queries = [];
    let redisCalls = 0;
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        queries.push({ sql, params });
        return {
          rows: [{
            id: 22,
            title: "The Return",
            artists: "Dogmedia Cast",
            duration: 180,
            mime_type: "video/mp4",
            category_id: 8,
            category_name: "Episodes",
            category_path: "Shows / Season Two / Episodes",
            artwork_version: "covers/season-two.jpg",
            suggested_category_id: 7,
            suggested_category_name: "Season Two",
            suggested_category_path: "Shows / Season Two",
          }],
        };
      },
    });
    const redis = redisMock();
    const originalMulti = redis.multi;
    redis.multi = (...args) => {
      redisCalls += 1;
      return originalMulti(...args);
    };
    app.decorate("redis", redis);
    app.addHook("onRequest", async (request) => {
      request.accessTier = 1;
      request.clientIp = "127.0.0.1";
    });
    await app.register(queueRoutes, { prefix: "/api/queue" });

    const response = await app.inject({ method: "GET", url: "/api/queue/suggestion/12?category=6" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      suggestion: {
        category: { id: 7, name: "Season Two" },
        media: { id: 22, title: "The Return", category_id: 8 },
      },
    });
    expect(queries[0].sql).toContain("COALESCE($3::integer, m.category_id)");
    expect(queries[0].sql).toContain("playable_categories");
    expect(queries[0].sql).toContain("cand.cycle_order");
    expect(queries[0].sql).toContain("split_part(m.mime_type, '/', 1) = current_item.media_family");
    expect(redisCalls).toBe(0);
    await app.close();
  });

  it("returns an empty suggestion when no sibling has matching media", async () => {
    const app = Fastify();
    app.decorate("pg", { async query() { return { rows: [] }; } });
    app.decorate("redis", redisMock());
    app.addHook("onRequest", async (request) => { request.accessTier = 0; });
    await app.register(queueRoutes, { prefix: "/api/queue" });

    const response = await app.inject({ method: "GET", url: "/api/queue/suggestion/12" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ suggestion: null });
    await app.close();
  });

  it("returns 400 for invalid media id or category id", async () => {
    const app = Fastify();
    app.decorate("pg", { async query() { return { rows: [] }; } });
    app.decorate("redis", redisMock());
    app.addHook("onRequest", async (request) => { request.accessTier = 0; });
    await app.register(queueRoutes, { prefix: "/api/queue" });

    const badMedia = await app.inject({ method: "GET", url: "/api/queue/suggestion/invalid" });
    expect(badMedia.statusCode).toBe(400);

    const badCat = await app.inject({ method: "GET", url: "/api/queue/suggestion/12?category=bad" });
    expect(badCat.statusCode).toBe(400);
    await app.close();
  });
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
          expire() { return chain; },
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

  it("appends liked audio without duplicating queued media", async () => {
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
          expire() { return chain; },
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
        return { rows: [{ id: 5 }, { id: 2 }, { id: 6 }] };
      },
    });
    app.decorate("redis", redis);
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(queueRoutes, { prefix: "/api/queue" });

    const response = await app.inject({ method: "POST", url: "/api/queue/items/likes" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      queue: [99, 2, 5, 6],
      currentIndex: 0,
      addedCount: 2,
    });
    expect(queries[0].sql).toContain("FROM liked_music l");
    expect(queries[0].sql).toContain("ORDER BY l.liked_at DESC");
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
          expire() { return chain; },
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

describe("queue next/prev trigger tracking", () => {
  it("records system trigger and returns trigger in response", async () => {
    let storedTrigger = null;
    const queue = [10, 20, 30];
    let idx = 0;
    const indexWrites = [];
    const expires = [];
    const redis = {
      async llen() { return queue.length; },
      async get(key) {
        if (key.startsWith("queue:index:")) return String(idx);
        if (key.startsWith("queue:trigger:")) return storedTrigger;
        return "0";
      },
      async set(key, val, ...args) {
        if (key.startsWith("queue:index:")) idx = Number(val);
        if (key.startsWith("queue:trigger:")) storedTrigger = String(val);
        if (key.startsWith("queue:index:")) indexWrites.push({ key, val, args });
        return "OK";
      },
      async expire(key, ttl) { expires.push({ key, ttl }); return 1; },
      async lindex(_key, i) { return String(queue[i]); },
      async incr() { return 1; },
    };
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(queueRoutes, { prefix: "/api/queue" });

    const resSystem = await app.inject({
      method: "POST",
      url: "/api/queue/next?compact=1",
      payload: { trigger: "system" },
    });
    expect(resSystem.statusCode).toBe(200);
    expect(resSystem.json()).toMatchObject({ mediaId: 20, trigger: "system" });
    expect(storedTrigger).toBe("system");

    const resUser = await app.inject({
      method: "POST",
      url: "/api/queue/next?compact=1",
      payload: { trigger: "user" },
    });
    expect(resUser.statusCode).toBe(200);
    expect(resUser.json()).toMatchObject({ mediaId: 30, trigger: "user" });
    expect(storedTrigger).toBe("user");

    const resPrev = await app.inject({
      method: "POST",
      url: "/api/queue/prev?compact=1",
      payload: { trigger: "system" },
    });
    expect(resPrev.statusCode).toBe(200);
    expect(resPrev.json()).toMatchObject({ mediaId: 20, trigger: "system" });
    expect(storedTrigger).toBe("system");
    expect(indexWrites).toEqual([
      { key: "queue:index:127.0.0.1", val: 1, args: ["EX", 604800] },
      { key: "queue:index:127.0.0.1", val: 2, args: ["EX", 604800] },
      { key: "queue:index:127.0.0.1", val: 1, args: ["EX", 604800] },
    ]);
    expect(expires.filter(({ key }) => key === "queue:127.0.0.1")).toEqual([
      { key: "queue:127.0.0.1", ttl: 604800 },
      { key: "queue:127.0.0.1", ttl: 604800 },
      { key: "queue:127.0.0.1", ttl: 604800 },
    ]);

    await app.close();
  });
});

describe("queue TTL enforcement", () => {
  it("sets TTL for a fresh item and refreshes both keys when it is added again", async () => {
    const evalCalls = [];
    let queue = [];
    const app = Fastify();
    app.decorate("pg", { query: async () => ({ rows: [{ id: 7 }] }) });
    app.decorate("redis", {
      async get(key) { return key.startsWith("queue:index:") ? "0" : null; },
      async eval(script, count, key, idxKey, mediaId, ttl) {
        evalCalls.push({ script, count, key, idxKey, mediaId, ttl, existing: queue.includes(mediaId) });
        if (!queue.includes(mediaId)) queue.push(mediaId);
        return queue;
      },
      async incr() { return 1; },
      async expire() { return 1; },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "192.168.1.50";
    });
    await app.register(queueRoutes, { prefix: "/api/queue" });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/queue/items?compact=1",
        payload: { mediaId: 7 },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ total: 1, currentMediaId: 7 });
    }

    expect(evalCalls.map(({ count, key, idxKey, mediaId, ttl, existing }) => ({
      count, key, idxKey, mediaId, ttl, existing,
    }))).toEqual([
      { count: 2, key: "queue:192.168.1.50", idxKey: "queue:index:192.168.1.50", mediaId: "7", ttl: 604800, existing: false },
      { count: 2, key: "queue:192.168.1.50", idxKey: "queue:index:192.168.1.50", mediaId: "7", ttl: 604800, existing: true },
    ]);
    const script = evalCalls[0].script;
    expect(script).toMatch(/if item == ARGV\[1\] then\s+redis\.call\('EXPIRE', KEYS\[1\], ARGV\[2\]\)\s+redis\.call\('EXPIRE', KEYS\[2\], ARGV\[2\]\)\s+return items/);
    expect(script).toContain("redis.call('EXPIRE', KEYS[1], ARGV[2])");
    expect(script).toContain("redis.call('SET', KEYS[2], 0, 'EX', ARGV[2])");
    expect(script).toMatch(/else\s+redis\.call\('EXPIRE', KEYS\[2\], ARGV\[2\]\)/);
    await app.close();
  });

  it("refreshes queue and index TTL when selecting an item", async () => {
    const sets = [];
    const expires = [];
    const app = Fastify();
    app.decorate("redis", {
      async get() { return null; },
      async lrange() { return ["7", "8"]; },
      async set(key, value, ...args) { sets.push({ key, value, args }); return "OK"; },
      async incr() { return 1; },
      async expire(key, ttl) { expires.push({ key, ttl }); return 1; },
    });
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "192.168.1.50";
    });
    await app.register(queueRoutes, { prefix: "/api/queue" });

    const response = await app.inject({
      method: "POST",
      url: "/api/queue/select?compact=1",
      payload: { mediaId: 8 },
    });
    expect(response.statusCode).toBe(200);
    expect(sets).toContainEqual({ key: "queue:index:192.168.1.50", value: 1, args: ["EX", 604800] });
    expect(expires).toContainEqual({ key: "queue:192.168.1.50", ttl: 604800 });
    expect(expires).toContainEqual({ key: "queue:revision:192.168.1.50", ttl: 604800 });
    await app.close();
  });

  it("enforces 7-day TTL on queue, index, and revision keys", async () => {
    const expires = [];
    const sets = [];
    const app = Fastify();
    app.decorate("pg", {
      async query(sql) {
        if (sql.includes("WITH ORDINALITY")) return { rows: [] };
        return { rows: [{ id: 1 }, { id: 2 }] };
      },
    });
    app.decorate("redis", {
      multi() {
        const chain = {
          del: () => chain,
          rpush: () => chain,
          expire: (key, ttl) => { expires.push({ key, ttl }); return chain; },
          set: (key, val, ...args) => { sets.push({ key, val, args }); return chain; },
          exec: async () => [],
        };
        return chain;
      },
      async incr() { return 1; },
      async expire(key, ttl) { expires.push({ key, ttl }); return 1; },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "192.168.1.50";
    });
    await app.register(queueRoutes, { prefix: "/api/queue" });

    const res = await app.inject({ method: "POST", url: "/api/queue/auto/7?start=1" });
    expect(res.statusCode).toBe(200);

    const sevenDays = 7 * 24 * 60 * 60;
    expect(expires).toContainEqual({ key: "queue:192.168.1.50", ttl: sevenDays });
    expect(expires).toContainEqual({ key: "queue:revision:192.168.1.50", ttl: sevenDays });
    expect(sets).toContainEqual({
      key: "queue:index:192.168.1.50",
      val: 0,
      args: ["EX", sevenDays],
    });

    await app.close();
  });
});

describe("exclusive lease queue guard", () => {
  const HOLDER_VIEWER = "a".repeat(24);
  const OTHER_VIEWER = "b".repeat(24);
  const HOLDER_IP = "192.168.1.50";

  function leaseRedis({ lease = null } = {}) {
    const leaseRaw = lease ? JSON.stringify(lease) : null;
    return {
      async get(key) {
        if (key === "stream:exclusive:standard") return leaseRaw;
        if (key.startsWith("queue:index:")) return "0";
        if (key.startsWith("queue:revision:")) return "0";
        return null;
      },
      async pttl() { return 24000; },
      async incr() { return 1; },
      async expire() { return 1; },
      async lrange() { return []; },
      async llen() { return 0; },
      multi() {
        const chain = {
          del: () => chain,
          rpush: () => chain,
          expire: () => chain,
          set: () => chain,
          exec: async () => [],
        };
        return chain;
      },
    };
  }

  function holderLease() {
    return {
      viewerId: HOLDER_VIEWER,
      sessionId: "c".repeat(43),
      mediaId: 7,
      clientIp: HOLDER_IP,
      platform: "desktop",
      deviceLabel: "Studio PC",
      acquiredAt: Date.now(),
      lastHeartbeatAt: Date.now(),
    };
  }

  async function leaseGuardApp({ lease, clientIp }) {
    const app = Fastify();
    app.decorate("pg", {
      async query(sql) {
        if (sql.includes("WITH ORDINALITY")) return { rows: [] };
        return { rows: [{ id: 1 }, { id: 2 }] };
      },
    });
    app.decorate("redis", leaseRedis({ lease }));
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = clientIp;
    });
    await app.register(queueRoutes, { prefix: "/api/queue" });
    return app;
  }

  function postAuto(app, viewerId) {
    return app.inject({
      method: "POST",
      url: "/api/queue/auto/7?start=1",
      headers: viewerId ? { "x-viewer-id": viewerId } : {},
    });
  }

  it("rejects queue replacement from a non-holder on the same IP", async () => {
    const app = await leaseGuardApp({ lease: holderLease(), clientIp: HOLDER_IP });
    const response = await postAuto(app, OTHER_VIEWER);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "PLAYBACK_IN_USE",
      activeSession: { platform: "desktop", deviceLabel: "Studio PC" },
    });
    await app.close();
  });

  it("rejects queue replacement when the request carries no viewer identity", async () => {
    const app = await leaseGuardApp({ lease: holderLease(), clientIp: HOLDER_IP });
    const response = await postAuto(app, null);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "PLAYBACK_IN_USE" });
    await app.close();
  });

  it("allows queue replacement for the lease holder", async () => {
    const app = await leaseGuardApp({ lease: holderLease(), clientIp: HOLDER_IP });
    const response = await postAuto(app, HOLDER_VIEWER);
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("allows queue replacement from a different IP with its own queue namespace", async () => {
    const app = await leaseGuardApp({ lease: holderLease(), clientIp: "10.0.0.9" });
    const response = await postAuto(app, OTHER_VIEWER);
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("allows queue replacement when no lease is held", async () => {
    const app = await leaseGuardApp({ lease: null, clientIp: HOLDER_IP });
    const response = await postAuto(app, OTHER_VIEWER);
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("keeps queue reads open for observers", async () => {
    const app = await leaseGuardApp({ lease: holderLease(), clientIp: HOLDER_IP });
    const response = await app.inject({
      method: "GET",
      url: "/api/queue/window",
      headers: { "x-viewer-id": OTHER_VIEWER },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
