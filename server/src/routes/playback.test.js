import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import playbackRoutes, {
  isSessionPauseExpired,
  normalizeTrigger,
  PAUSE_MAX_IDLE_MS,
  RESUME_TTL_SECONDS,
} from "./playback.js";

describe("playback pause cache helpers", () => {
  it("normalizes trigger correctly", () => {
    expect(normalizeTrigger("system")).toBe("system");
    expect(normalizeTrigger("user")).toBe("user");
    expect(normalizeTrigger(undefined)).toBe("user");
    expect(normalizeTrigger("unknown")).toBe("user");
  });

  it("evaluates pause expiration correctly", () => {
    const now = 1_700_000_000_000;

    // Not paused: never expired
    expect(isSessionPauseExpired({ action: "play", state: "playing" }, now)).toBe(false);

    // Paused 10 minutes ago (< 30 minutes): not expired
    const recentPause = {
      action: "pause",
      state: "paused",
      trigger: "user",
      pausedAt: new Date(now - 10 * 60 * 1000).toISOString(),
    };
    expect(isSessionPauseExpired(recentPause, now)).toBe(false);

    // Paused exactly 30 minutes ago (>= 30 minutes): expired
    const expiredPause = {
      action: "pause",
      state: "paused",
      trigger: "user",
      pausedAt: new Date(now - 30 * 60 * 1000).toISOString(),
    };
    expect(isSessionPauseExpired(expiredPause, now)).toBe(true);

    // User-controlled next that was paused 35 minutes ago: expired
    const userControlledExpired = {
      action: "pause",
      state: "paused",
      trigger: "user",
      pausedAt: new Date(now - 35 * 60 * 1000).toISOString(),
    };
    expect(isSessionPauseExpired(userControlledExpired, now)).toBe(true);

    // System-controlled next that was paused 35 minutes ago: expired
    const systemControlledExpired = {
      action: "pause",
      state: "paused",
      trigger: "system",
      pausedAt: new Date(now - 35 * 60 * 1000).toISOString(),
    };
    expect(isSessionPauseExpired(systemControlledExpired, now)).toBe(true);

    // Falls back to timestamp if pausedAt is missing
    const timestampFallback = {
      action: "pause",
      state: "paused",
      timestamp: new Date(now - 31 * 60 * 1000).toISOString(),
    };
    expect(isSessionPauseExpired(timestampFallback, now)).toBe(true);
  });
});

function createMockRedis(initialKeys = {}) {
  const store = new Map(Object.entries(initialKeys));
  const zsets = new Map();
  const expiresAt = new Map();

  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value, _mode, _duration) {
      store.set(key, String(value));
      return "OK";
    },
    async del(key) {
      expiresAt.delete(key);
      store.delete(key);
      return 1;
    },
    async pttl(key) {
      return expiresAt.has(key) ? expiresAt.get(key) - Date.now() : -1;
    },
    async eval(script, keyCount, key, ...args) {
      if (script.includes("lastHeartbeatAt")) {
        const current = store.has(key) ? JSON.parse(store.get(key)) : null;
        if (!current) return [0, -2];
        if (current.viewerId !== args[0] || current.sessionId !== args[1] || current.clientIp !== args[2]) {
          const ttl = Math.max(0, (expiresAt.get(key) ?? Date.now()) - Date.now());
          return [0, JSON.stringify(current), ttl];
        }
        current.lastHeartbeatAt = Number(args[3]);
        store.set(key, JSON.stringify(current));
        expiresAt.set(key, Date.now() + Number(args[4]));
        return [1, Number(args[4])];
      }
      const current = store.has(key) ? JSON.parse(store.get(key)) : null;
      if (!current || current.viewerId !== args[0] || (args[1] && current.sessionId !== args[1]) || current.clientIp !== args[2]) return 0;
      store.delete(key);
      expiresAt.delete(key);
      return 1;
    },
    async mget(keys) {
      return keys.map((k) => (store.has(k) ? store.get(k) : null));
    },
    async zadd(key, score, member) {
      if (!zsets.has(key)) zsets.set(key, new Map());
      zsets.get(key).set(member, score);
      return 1;
    },
    async zrem(key, member) {
      if (zsets.has(key)) zsets.get(key).delete(member);
      return 1;
    },
    async zremrangebyscore(key, min, max) {
      if (!zsets.has(key)) return 0;
      const set = zsets.get(key);
      let removed = 0;
      for (const [member, score] of set.entries()) {
        if (score <= max) {
          set.delete(member);
          removed++;
        }
      }
      return removed;
    },
    async zrangebyscore(key, min, _max) {
      if (!zsets.has(key)) return [];
      const set = zsets.get(key);
      const members = [];
      for (const [member, score] of set.entries()) {
        if (score >= min) members.push(member);
      }
      return members;
    },
    multi() {
      const ops = [];
      const chain = {
        set(key, value, _mode, _duration) {
          ops.push(() => store.set(key, String(value)));
          return chain;
        },
        del(key) {
          ops.push(() => store.delete(key));
          return chain;
        },
        zadd(key, score, member) {
          ops.push(() => {
            if (!zsets.has(key)) zsets.set(key, new Map());
            zsets.get(key).set(member, score);
          });
          return chain;
        },
        zrem(key, member) {
          ops.push(() => {
            if (zsets.has(key)) zsets.get(key).delete(member);
          });
          return chain;
        },
        async exec() {
          for (const op of ops) op();
          return [];
        },
      };
      return chain;
    },
    _store: store,
    _zsets: zsets,
  };
}

describe("playback resume routes", () => {
  it("keeps resume positions for RESUME_TTL_SECONDS (15 minutes by default)", () => {
    expect(RESUME_TTL_SECONDS).toBe(900);
  });

  it("stores POSTed resume positions with the resume TTL", async () => {
    const setCalls = [];
    const base = createMockRedis();
    const redis = {
      ...base,
      async set(key, value, mode, duration) {
        setCalls.push([key, mode, duration]);
        return base.set(key, value, mode, duration);
      },
    };
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const response = await app.inject({
      method: "POST",
      url: "/api/playback/resume/42",
      payload: { position: 120, duration: 300 },
    });

    expect(response.statusCode).toBe(200);
    expect(setCalls).toContainEqual([
      "playback:resume:127.0.0.1:42",
      "EX",
      RESUME_TTL_SECONDS,
    ]);

    await app.close();
  });

  it("treats a corrupted Redis resume value as a cache miss", async () => {
    const redis = createMockRedis({
      "playback:resume:127.0.0.1:42": "not-json",
    });
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const response = await app.inject({
      method: "GET",
      url: "/api/playback/resume/42",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ position: null });

    await app.close();
  });
});

describe("playback active cache routes", () => {
  it("stores active pause session with 1800s TTL and trigger metadata", async () => {
    const redis = createMockRedis();
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", {
      async query() {
        return { rows: [{ id: 42, title: "Test Track" }] };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 100;
      request.clientIp = "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const res = await app.inject({
      method: "POST",
      url: "/api/playback/active",
      payload: {
        mediaId: 42,
        action: "pause",
        position: 15,
        duration: 120,
        trigger: "user",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, trigger: "user", state: "paused" });

    const raw = await redis.get("playback:active:127.0.0.1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.mediaId).toBe(42);
    expect(parsed.action).toBe("pause");
    expect(parsed.state).toBe("paused");
    expect(parsed.trigger).toBe("user");
    expect(parsed.pausedAt).toBeTruthy();

    await app.close();
  });

  it("validates pause state and drops cache if pause exceeded 30 minutes on GET /active", async () => {
    const now = Date.now();
    const expiredPausedAt = new Date(now - (PAUSE_MAX_IDLE_MS + 5000)).toISOString();
    const redis = createMockRedis({
      "playback:active:127.0.0.1": JSON.stringify({
        mediaId: 42,
        action: "pause",
        state: "paused",
        position: 10,
        trigger: "user",
        pausedAt: expiredPausedAt,
        timestamp: expiredPausedAt,
        ip: "127.0.0.1",
      }),
    });
    await redis.zadd("playback:active:index", now + 1000, "127.0.0.1");

    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", {
      async query() {
        return { rows: [] };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 100;
      request.clientIp = "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const res = await app.inject({
      method: "GET",
      url: "/api/playback/active",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ active: null, dropped: true, reason: "pause_timeout" });

    // Cache should be completely deleted from Redis
    const cachedAfter = await redis.get("playback:active:127.0.0.1");
    expect(cachedAfter).toBeNull();

    await app.close();
  });

  it("returns active session when pause duration is under 30 minutes", async () => {
    const now = Date.now();
    const recentPausedAt = new Date(now - 5 * 60 * 1000).toISOString();
    const redis = createMockRedis({
      "playback:active:127.0.0.1": JSON.stringify({
        mediaId: 42,
        action: "pause",
        state: "paused",
        position: 10,
        trigger: "system",
        pausedAt: recentPausedAt,
        timestamp: recentPausedAt,
        ip: "127.0.0.1",
      }),
    });
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", {
      async query() {
        return { rows: [{ id: 42, title: "Hydrated Title" }] };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 100;
      request.clientIp = "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const res = await app.inject({
      method: "GET",
      url: "/api/playback/active",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().active).toMatchObject({
      mediaId: 42,
      title: "Hydrated Title",
      action: "pause",
      state: "paused",
      trigger: "system",
    });

    await app.close();
  });

  it("drops active cache on DELETE /active", async () => {
    const redis = createMockRedis({
      "playback:active:127.0.0.1": JSON.stringify({ mediaId: 1, action: "play", ip: "127.0.0.1" }),
    });
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", { async query() { return { rows: [] }; } });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 100;
      request.clientIp = "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const delRes = await app.inject({
      method: "DELETE",
      url: "/api/playback/active",
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toMatchObject({ ok: true, dropped: true });
    expect(await redis.get("playback:active:127.0.0.1")).toBeNull();

    await app.close();
  });

  it("filters out and drops expired pause sessions on GET /now-playing", async () => {
    const now = Date.now();
    const expiredPausedAt = new Date(now - (PAUSE_MAX_IDLE_MS + 10000)).toISOString();
    const recentPausedAt = new Date(now - 1000).toISOString();

    const redis = createMockRedis({
      "playback:active:192.168.1.10": JSON.stringify({
        mediaId: 1,
        title: "Track 1",
        action: "pause",
        pausedAt: expiredPausedAt,
        trigger: "user",
      }),
      "playback:active:192.168.1.20": JSON.stringify({
        mediaId: 2,
        title: "Track 2",
        action: "pause",
        pausedAt: recentPausedAt,
        trigger: "system",
      }),
    });
    await redis.zadd("playback:active:index", now + 10000, "192.168.1.10");
    await redis.zadd("playback:active:index", now + 10000, "192.168.1.20");

    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", {
      async query() {
        return { rows: [] };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 100;
      request.clientIp = "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const res = await app.inject({
      method: "GET",
      url: "/api/playback/now-playing",
    });

    expect(res.statusCode).toBe(200);
    const sessions = res.json();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].ip).toBe("192.168.1.20");

    // The expired session should have been dropped from redis
    expect(await redis.get("playback:active:192.168.1.10")).toBeNull();

    await app.close();
  });

  it("returns empty array and does not invoke redis.scan when no active sessions exist", async () => {
    const scanSpy = vi.fn();
    const redis = {
      ...createMockRedis(),
      scan: scanSpy,
    };

    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", {
      async query() {
        return { rows: [] };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 100;
      request.clientIp = "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const res = await app.inject({
      method: "GET",
      url: "/api/playback/now-playing",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(scanSpy).not.toHaveBeenCalled();

    await app.close();
  });

  it("applies type filter in dashboard summary", async () => {
    let capturedQuery = "";
    const redis = createMockRedis();
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", {
      async query(sql) {
        capturedQuery = sql;
        return { rows: [] };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 100;
      request.clientIp = "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const res = await app.inject({
      method: "GET",
      url: "/api/playback/dashboard?type=video",
    });

    expect(res.statusCode).toBe(200);
    expect(capturedQuery).toContain("m.mime_type LIKE 'video/%'");

    await app.close();
  });
});

describe("exclusive playback lease routes", () => {
  it("renews and releases a lease only for its bound viewer, session, and IP", async () => {
    const viewerId = "viewer_aaaaaaaaaaaaaaaaaaaa";
    const sessionId = "session_aaaaaaaaaaaaaaaaaaa";
    const redis = createMockRedis({
      [`stream:session:${sessionId}`]: JSON.stringify({ viewerId, clientIp: "127.0.0.1", leaseRequired: true }),
      "stream:exclusive:standard": JSON.stringify({ viewerId, sessionId, clientIp: "127.0.0.1", mediaId: 42, platform: "web" }),
    });
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = request.headers["x-test-client-ip"] || "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const denied = await app.inject({
      method: "POST",
      url: "/api/playback/lease/heartbeat",
      headers: { "x-playback-session": sessionId, "x-viewer-id": "viewer_bbbbbbbbbbbbbbbbbbbb" },
    });
    expect(denied.statusCode).toBe(401);

    const deniedFromAnotherIp = await app.inject({
      method: "POST",
      url: "/api/playback/lease/heartbeat",
      headers: {
        "x-playback-session": sessionId,
        "x-viewer-id": viewerId,
        "x-test-client-ip": "192.168.1.20",
      },
    });
    expect(deniedFromAnotherIp.statusCode).toBe(401);

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/playback/lease/heartbeat",
      headers: { "x-playback-session": sessionId, "x-viewer-id": viewerId },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json()).toMatchObject({ ok: true });

    const status = await app.inject({
      method: "GET",
      url: "/api/playback/lease",
      headers: { "x-viewer-id": viewerId },
    });
    expect(status.json()).toMatchObject({
      state: "owned",
      activeSession: { mediaId: 42, platform: "web" },
    });
    expect(status.json().activeSession).not.toHaveProperty("viewerId");
    expect(status.json().activeSession).not.toHaveProperty("sessionId");

    const released = await app.inject({
      method: "DELETE",
      url: "/api/playback/lease",
      headers: { "x-playback-session": sessionId, "x-viewer-id": viewerId },
    });
    expect(released.json()).toEqual({ ok: true, released: true });
    expect(await redis.get("stream:exclusive:standard")).toBeNull();
    expect(await redis.get(`stream:session:${sessionId}`)).toBeNull();
    await app.close();
  });

  it("reports the safe holder when a heartbeat loses the lease", async () => {
    const holderSessionId = "session_hhhhhhhhhhhhhhhhhhh";
    const redis = createMockRedis({
      "stream:session:session_aaaaaaaaaaaaaaaaaaa": JSON.stringify({
        viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
        clientIp: "127.0.0.1",
        leaseRequired: true,
      }),
      "stream:exclusive:standard": JSON.stringify({
        viewerId: "viewer_bbbbbbbbbbbbbbbbbbbb",
        sessionId: holderSessionId,
        mediaId: 7,
        clientIp: "127.0.0.1",
        platform: "mobile",
        deviceLabel: "Phone",
      }),
    });
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/playback/lease/heartbeat",
      headers: {
        "x-playback-session": "session_aaaaaaaaaaaaaaaaaaa",
        "x-viewer-id": "viewer_aaaaaaaaaaaaaaaaaaaa",
      },
    });
    expect(heartbeat.statusCode).toBe(409);
    const body = heartbeat.json();
    expect(body.code).toBe("PLAYBACK_LEASE_LOST");
    expect(body.error).toContain("Phone");
    expect(body.activeSession).toMatchObject({
      platform: "mobile",
      deviceLabel: "Phone",
      mediaId: 7,
    });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("viewer_bbbbbbbbbbbbbbbbbbbb");
    expect(raw).not.toContain(holderSessionId);
    expect(body).not.toHaveProperty("viewerId");
    expect(body).not.toHaveProperty("sessionId");
    await app.close();
  });

  it("exposes the holder on busy lease status without sensitive identifiers", async () => {
    const redis = createMockRedis({
      "stream:exclusive:standard": JSON.stringify({
        viewerId: "viewer_bbbbbbbbbbbbbbbbbbbb",
        sessionId: "session_hhhhhhhhhhhhhhhhhhh",
        mediaId: 7,
        clientIp: "10.9.9.9",
        platform: "desktop",
        deviceLabel: "Studio PC",
      }),
    });
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const busy = await app.inject({ method: "GET", url: "/api/playback/lease" });
    expect(busy.json()).toMatchObject({
      state: "busy",
      activeSession: { platform: "desktop", deviceLabel: "Studio PC", mediaId: 7 },
    });
    const raw = JSON.stringify(busy.json());
    expect(raw).not.toContain("viewer_bbbbbbbbbbbbbbbbbbbb");
    expect(raw).not.toContain("10.9.9.9");

    const empty = createMockRedis();
    const app2 = Fastify();
    app2.decorate("redis", empty);
    app2.decorate("pg", { query: async () => ({ rows: [] }) });
    app2.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "127.0.0.1";
    });
    await app2.register(playbackRoutes, { prefix: "/api/playback" });
    expect((await app2.inject({ method: "GET", url: "/api/playback/lease" })).json())
      .toEqual({ state: "available", expiresIn: 0 });
    await app.close();
    await app2.close();
  });

  it("reports lease ownership only when both viewer and IP match", async () => {
    const redis = createMockRedis({
      "stream:exclusive:standard": JSON.stringify({
        viewerId: "viewer_bbbbbbbbbbbbbbbbbbbb",
        sessionId: "session_hhhhhhhhhhhhhhhhhhh",
        mediaId: 7,
        clientIp: "192.168.1.20",
        platform: "desktop",
        deviceLabel: "Studio PC",
      }),
    });
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "192.168.1.20";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const sameIpDifferentViewer = await app.inject({
      method: "GET",
      url: "/api/playback/lease",
      headers: { "x-viewer-id": "viewer_aaaaaaaaaaaaaaaaaaaa" },
    });
    expect(sameIpDifferentViewer.json().state).toBe("busy");

    const owner = await app.inject({
      method: "GET",
      url: "/api/playback/lease",
      headers: { "x-viewer-id": "viewer_bbbbbbbbbbbbbbbbbbbb" },
    });
    expect(owner.json()).toMatchObject({
      state: "owned",
      activeSession: { platform: "desktop", deviceLabel: "Studio PC", mediaId: 7 },
    });
    await app.close();
  });

  it("mirrors the owner snapshot and rejects duplicate position reporters", async () => {
    const ownerViewer = "viewer_bbbbbbbbbbbbbbbbbbbb";
    const ownerSession = "session_hhhhhhhhhhhhhhhhhhh";
    const activeKey = `playback:active:${ownerViewer}`;
    const originalSnapshot = {
      mediaId: 7,
      title: "Owner supplied title",
      action: "play",
      state: "playing",
      position: 31,
      duration: 180,
      loopMode: "queue",
      shuffleEnabled: true,
      timestamp: "2026-10-05T08:00:00.000Z",
      ip: "192.168.1.20",
    };
    const redis = createMockRedis({
      "stream:exclusive:standard": JSON.stringify({
        viewerId: ownerViewer,
        sessionId: ownerSession,
        mediaId: 7,
        clientIp: "192.168.1.20",
        platform: "desktop",
        deviceLabel: "Studio PC",
      }),
      [`stream:session:${ownerSession}`]: JSON.stringify({
        viewerId: ownerViewer,
        mediaId: 7,
        clientIp: "192.168.1.20",
        leaseRequired: true,
      }),
      [activeKey]: JSON.stringify(originalSnapshot),
    });
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = Number(request.headers["x-test-tier"] || 0);
      request.clientIp = "192.168.1.20";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    const observed = await app.inject({
      method: "GET",
      url: "/api/playback/lease",
      headers: { "x-viewer-id": "viewer_aaaaaaaaaaaaaaaaaaaa" },
    });
    expect(observed.json()).toMatchObject({
      state: "busy",
      activeSession: {
        deviceLabel: "Studio PC",
        playback: {
          mediaId: 7,
          action: "play",
          position: 31,
          duration: 180,
          loopMode: "queue",
          shuffleEnabled: true,
        },
      },
    });
    expect(JSON.stringify(observed.json())).not.toContain("192.168.1.20");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/playback/active",
      headers: {
        "x-viewer-id": "viewer_aaaaaaaaaaaaaaaaaaaa",
        "x-playback-session": "session_aaaaaaaaaaaaaaaaaaa",
      },
      payload: { mediaId: 7, mediaType: "audio/mpeg", action: "play", position: 99, duration: 180 },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("PLAYBACK_NOT_OWNER");
    expect(JSON.parse(await redis.get(activeKey)).position).toBe(31);

    const disguisedDuplicate = await app.inject({
      method: "POST",
      url: "/api/playback/active",
      headers: { "x-viewer-id": "viewer_aaaaaaaaaaaaaaaaaaaa" },
      payload: { mediaId: 8, action: "play", position: 77, duration: 200 },
    });
    expect(disguisedDuplicate.statusCode).toBe(409);
    expect(disguisedDuplicate.json().code).toBe("PLAYBACK_NOT_OWNER");
    expect(await redis.get("playback:active:viewer_aaaaaaaaaaaaaaaaaaaa")).toBeNull();

    const owner = await app.inject({
      method: "POST",
      url: "/api/playback/active",
      headers: { "x-viewer-id": ownerViewer, "x-playback-session": ownerSession },
      payload: { mediaId: 7, mediaType: "audio/mpeg", action: "play", position: 42, duration: 180 },
    });
    expect(owner.statusCode).toBe(200);
    expect(JSON.parse(await redis.get(activeKey)).position).toBe(42);

    const takeover = await app.inject({
      method: "DELETE",
      url: "/api/playback/lease/admin",
      headers: { "x-test-tier": "100" },
    });
    expect(takeover.json()).toEqual({ ok: true, released: true });
    expect(await redis.get(activeKey)).toBeNull();
    await app.close();
  });

  it("keeps active-playing state separate for two devices behind the same IP", async () => {
    const redis = createMockRedis();
    const app = Fastify();
    app.decorate("redis", redis);
    app.decorate("pg", { query: async () => ({ rows: [{ id: 42, title: "Track" }] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 0;
      request.clientIp = "192.168.1.20";
    });
    await app.register(playbackRoutes, { prefix: "/api/playback" });

    for (const viewerId of ["viewer_aaaaaaaaaaaaaaaaaaaa", "viewer_bbbbbbbbbbbbbbbbbbbb"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/playback/active",
        headers: { "x-viewer-id": viewerId },
        payload: { mediaId: 42, action: "play", position: 0, duration: 120 },
      });
      expect(response.statusCode).toBe(200);
    }

    expect(await redis.get("playback:active:viewer_aaaaaaaaaaaaaaaaaaaa")).toBeTruthy();
    expect(await redis.get("playback:active:viewer_bbbbbbbbbbbbbbbbbbbb")).toBeTruthy();
    await app.close();
  });
});
