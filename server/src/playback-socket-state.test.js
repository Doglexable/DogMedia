import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import playbackRoutes from "./routes/playback.js";
import { createPlaybackSocketHub } from "./playback-socket.js";
import { issueSocketTicket } from "./playback-session.js";
import { PAUSE_MAX_IDLE_MS } from "./playback-now-playing.js";

function createRedis() {
  const values = new Map();
  const scores = new Map();
  const redis = {
    values, scores,
    async set(key, value) { values.set(key, value); },
    async get(key) { return values.get(key) ?? null; },
    async getdel(key) { const value = values.get(key) ?? null; values.delete(key); return value; },
    async del(key) { values.delete(key); },
    async mget(keys) { return keys.map((key) => values.get(key) ?? null); },
    async zadd(_key, score, member) { scores.set(member, Number(score)); },
    async zrem(_key, member) { scores.delete(member); },
    async zremrangebyscore(_key, _min, max) {
      for (const [member, score] of scores) if (score <= Number(max)) scores.delete(member);
    },
    async zrangebyscore(_key, min) {
      return [...scores].filter(([, score]) => score >= Number(min)).map(([member]) => member);
    },
    async zrange(_key, _start, _stop, withScores) {
      const first = [...scores].sort((a, b) => a[1] - b[1])[0];
      return first ? (withScores === "WITHSCORES" ? [first[0], String(first[1])] : [first[0]]) : [];
    },
    multi() {
      const operations = [];
      const chain = {
        del(key) { operations.push(() => redis.del(key)); return chain; },
        zrem(key, member) { operations.push(() => redis.zrem(key, member)); return chain; },
        async exec() { for (const operation of operations) await operation(); return []; },
      };
      return chain;
    },
  };
  return redis;
}

async function createApp(redis) {
  const app = Fastify();
  await app.register(websocket);
  app.decorate("redis", redis);
  app.decorate("pg", { async query(sql) {
    if (sql.includes("SELECT session_version")) return { rows: [{ session_version: 0 }] };
    if (sql.includes("FROM media_assets")) return { rows: [{ id: 17, title: "Track 17" }] };
    if (sql.includes("FROM users")) return { rows: [{ id: 7, username: "admin", profile_picture: "fine" }] };
    return { rows: [] };
  } });
  app.decorate("playbackSocketHub", createPlaybackSocketHub(app));
  await app.register(async (scope) => {
    scope.addHook("onRequest", async (request) => {
      request.clientIp = "192.0.2.1";
      request.accessTier = Number(request.headers["x-tier"] || 0);
      request.user = { id: request.accessTier >= 100 ? 7 : 8, session_version: 0 };
    });
    await scope.register(playbackRoutes, { prefix: "/playback" });
  }, { prefix: "/api" });
  await app.ready();
  return app;
}

async function connect(app, redis, tier) {
  const ticket = await issueSocketTicket(redis, {
    userId: tier >= 100 ? 7 : 8, sessionVersion: 0, viewerId: "v".repeat(32),
    clientIp: "192.0.2.1", accessTier: tier, platform: "web",
  });
  const socket = await app.injectWS("/api/playback/socket", { headers: { "x-tier": String(tier) } });
  const events = [];
  socket.on("message", (raw) => events.push(JSON.parse(raw.toString())));
  socket.send(JSON.stringify({ type: "auth", version: 1, ticket }));
  await vi.waitFor(() => expect(events.some((event) => event.type === "socket.ready")).toBe(true));
  return { socket, events };
}

describe("playback socket dashboard and resume state", () => {
  it("sends admin now-playing snapshots on subscription, changes, and expiry without exposing them to standard users", async () => {
    const redis = createRedis();
    const identity = "192.0.2.1:viewer";
    redis.values.set(`playback:active:${identity}`, JSON.stringify({ mediaId: 17, action: "play", position: 12, duration: 90, userId: 7, timestamp: new Date().toISOString() }));
    redis.scores.set(identity, Date.now() + 30_000);
    const app = await createApp(redis);
    let admin;
    let standard;
    try {
      admin = await connect(app, redis, 100);
      standard = await connect(app, redis, 0);
      standard.socket.send(JSON.stringify({ type: "now-playing.subscribe", version: 1 }));
      await vi.waitFor(() => expect(standard.events.some((event) => event.code === "ACCESS_DENIED")).toBe(true));
      expect(standard.events.some((event) => event.type === "now-playing.state")).toBe(false);

      admin.socket.send(JSON.stringify({ type: "now-playing.subscribe", version: 1 }));
      await vi.waitFor(() => expect(admin.events.some((event) => event.type === "now-playing.state")).toBe(true));
      expect(admin.events.find((event) => event.type === "now-playing.state")?.sessions).toMatchObject([
        { mediaId: 17, title: "Track 17", username: "admin", action: "play" },
      ]);

      redis.values.set(`playback:active:${identity}`, JSON.stringify({ mediaId: 17, action: "pause", position: 20, duration: 90, userId: 7, timestamp: new Date().toISOString() }));
      await app.playbackSocketHub.notify();
      await vi.waitFor(() => expect(admin.events.filter((event) => event.type === "now-playing.state").at(-1)?.sessions[0]?.action).toBe("pause"));

      redis.scores.set(identity, Date.now() + 150);
      await app.playbackSocketHub.notify();
      await vi.waitFor(() => expect(admin.events.filter((event) => event.type === "now-playing.state").at(-1)?.sessions).toEqual([]), { timeout: 1500 });

      redis.values.set(`playback:active:${identity}`, JSON.stringify({
        mediaId: 17, action: "pause", position: 20, duration: 90, userId: 7,
        pausedAt: new Date(Date.now() - PAUSE_MAX_IDLE_MS + 300).toISOString(),
        timestamp: new Date().toISOString(),
      }));
      redis.scores.set(identity, Date.now() + 30_000);
      await app.playbackSocketHub.notify();
      await vi.waitFor(() => expect(admin.events.filter((event) => event.type === "now-playing.state").at(-1)?.sessions).toHaveLength(1));
      await vi.waitFor(() => expect(admin.events.filter((event) => event.type === "now-playing.state").at(-1)?.sessions).toEqual([]), { timeout: 1500 });
    } finally {
      admin?.socket.close();
      standard?.socket.close();
      await app.close();
    }
  });

  it("reads and saves resume positions over the authenticated socket using the existing Redis key", async () => {
    const redis = createRedis();
    const app = await createApp(redis);
    let client;
    try {
      client = await connect(app, redis, 0);
      client.socket.send(JSON.stringify({ type: "resume.save", version: 1, mediaId: 17, position: 42, duration: 90 }));
      await vi.waitFor(() => expect(redis.values.has("playback:resume:192.0.2.1:17")).toBe(true));
      client.socket.send(JSON.stringify({ type: "resume.get", version: 1, mediaId: 17, requestId: 4 }));
      await vi.waitFor(() => expect(client.events.find((event) => event.type === "resume.state" && event.requestId === 4)?.position).toBe(42));
      client.socket.send(JSON.stringify({ type: "resume.save", version: 1, mediaId: 17, position: 89, duration: 90 }));
      await vi.waitFor(() => expect(redis.values.has("playback:resume:192.0.2.1:17")).toBe(false));
    } finally {
      client?.socket.close();
      await app.close();
    }
  });
});
