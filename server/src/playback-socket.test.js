import { describe, expect, it, vi } from "vitest";
import { consumeSocketTicket, issueSocketTicket, playbackSessionKey, socketTicketKey } from "./playback-session.js";
import { parsePlaybackMessage, SOCKET_MAX_BYTES } from "./playback-socket.js";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import playbackRoutes from "./routes/playback.js";
import { createPlaybackSocketHub } from "./playback-socket.js";

describe("playback socket protocol", () => {
  it("accepts only versioned bounded messages", () => {
    expect(parsePlaybackMessage(JSON.stringify({ type: "session.bind", version: 1, sessionId: "x".repeat(32) })).type).toBe("session.bind");
    expect(() => parsePlaybackMessage(JSON.stringify({ type: "session.bind", version: 2, sessionId: "x".repeat(32) }))).toThrow();
    expect(() => parsePlaybackMessage(JSON.stringify({ type: "playback.state", version: 1, position: Infinity }))).toThrow();
    expect(() => parsePlaybackMessage("x".repeat(SOCKET_MAX_BYTES + 1))).toThrow();
  });

  it("uses a hashed one-use ticket tied to the source IP", async () => {
    const keys = new Map();
    const redis = {
      async set(key, value, mode, ttl) { expect([mode, ttl]).toEqual(["EX", 30]); keys.set(key, value); },
      async getdel(key) { const value = keys.get(key); keys.delete(key); return value; },
    };
    const identity = { viewerId: "viewer", clientIp: "192.0.2.1", accessTier: 100 };
    const ticket = await issueSocketTicket(redis, identity);
    expect(keys.has(socketTicketKey(ticket))).toBe(true);
    expect([...keys.keys()][0]).not.toContain(ticket);
    expect(await consumeSocketTicket(redis, ticket, "192.0.2.2")).toBeNull();
    expect(await consumeSocketTicket(redis, ticket, "192.0.2.1")).toBeNull();
    const second = await issueSocketTicket(redis, identity);
    expect(second).not.toBe(ticket);
    expect(await consumeSocketTicket(redis, second, "192.0.2.1")).toEqual(identity);
  });
});

describe("protected playback socket route", () => {
  it("uses the access hook and sends an initial safe state after one-use authentication", async () => {
    const store = new Map();
    const redis = {
      async set(key, value) { store.set(key, value); },
      async get(key) { return store.get(key) || null; },
      async getdel(key) { const value = store.get(key) || null; store.delete(key); return value; },
    };
    const app = Fastify();
    await app.register(websocket);
    app.decorate("redis", redis);
    app.decorate("playbackSocketHub", createPlaybackSocketHub(app));
    await app.register(async (scope) => {
      scope.addHook("onRequest", async (request, reply) => {
        request.clientIp = "192.0.2.1";
        if (request.headers["x-test-access"] !== "yes") return reply.code(403).send({ error: "Access denied" });
        request.accessTier = 0;
      });
      await scope.register(playbackRoutes, { prefix: "/playback" });
    }, { prefix: "/api" });
    await app.ready();
    try {
      const denied = await app.inject({ method: "POST", url: "/api/playback/socket-ticket" });
      expect(denied.statusCode).toBe(403);
      await expect(app.injectWS("/api/playback/socket", { headers: { origin: "https://evil.example", "x-test-access": "yes" } })).rejects.toThrow();
      await expect(app.injectWS("/api/playback/socket")).rejects.toThrow();
      const ticketResponse = await app.inject({ method: "POST", url: "/api/playback/socket-ticket", headers: { "x-test-access": "yes" } });
      expect(ticketResponse.statusCode).toBe(200);
      const { ticket } = ticketResponse.json();
      const socket = await app.injectWS("/api/playback/socket", { headers: { "x-test-access": "yes" } });
      const received = [];
      socket.on("message", (raw) => received.push(JSON.parse(raw.toString())));
      socket.send(JSON.stringify({ type: "auth", version: 1, ticket }));
      await vi.waitFor(() => expect(received.map((value) => value.type)).toEqual(["socket.ready", "lease.state"]));
      expect(received[1]).toMatchObject({ state: "available", expiresIn: 0 });
      expect(JSON.stringify(received)).not.toContain(ticket);
      socket.close();
    } finally {
      await app.close();
    }
  });

  it("pushes takeover and force release immediately and rejects non-owner or stale state", async () => {
    const store = new Map();
    const chain = { set(key, value) { store.set(key, value); return chain; }, del(key) { store.delete(key); return chain; }, zadd() { return chain; }, zrem() { return chain; }, async exec() { return []; } };
    const redis = {
      async set(key, value) { store.set(key, value); },
      async get(key) { return store.get(key) || null; },
      async getdel(key) { const value = store.get(key) || null; store.delete(key); return value; },
      async del(key) { const existed = store.delete(key); return existed ? 1 : 0; },
      async pttl() { return 30_000; },
      multi() { return chain; },
    };
    const app = Fastify();
    await app.register(websocket);
    app.decorate("redis", redis);
    app.decorate("playbackSocketHub", createPlaybackSocketHub(app));
    await app.register(async (scope) => {
      scope.addHook("onRequest", async (request) => {
        request.clientIp = "192.0.2.1";
        request.accessTier = 100;
      });
      await scope.register(playbackRoutes, { prefix: "/playback" });
    }, { prefix: "/api" });
    await app.ready();
    const ownerId = "o".repeat(32);
    const otherId = "u".repeat(32);
    const sessionId = "s".repeat(32);
    const identity = (viewerId) => ({ viewerId, clientIp: "192.0.2.1", accessTier: 100, platform: "web", deviceLabel: "Web" });
    const connect = async (viewerId) => {
      const ticket = await issueSocketTicket(redis, identity(viewerId));
      const socket = await app.injectWS("/api/playback/socket");
      const events = [];
      socket.on("message", (raw) => events.push(JSON.parse(raw.toString())));
      socket.send(JSON.stringify({ type: "auth", version: 1, ticket }));
      await vi.waitFor(() => expect(events.some((event) => event.type === "lease.state")).toBe(true));
      return { socket, events };
    };
    const owner = await connect(ownerId);
    const observer = await connect(otherId);
    try {
      store.set(playbackSessionKey(sessionId), JSON.stringify({ mediaId: 5, viewerId: ownerId, clientIp: "192.0.2.1", accessTier: 100, leaseRequired: true }));
      store.set("stream:exclusive:standard", JSON.stringify({ viewerId: ownerId, sessionId, clientIp: "192.0.2.1", mediaId: 5, platform: "web", deviceLabel: "Web" }));
      await app.playbackSocketHub.notify();
      await vi.waitFor(() => expect(owner.events.at(-1)?.state).toBe("owned"));
      await vi.waitFor(() => expect(observer.events.at(-1)?.state).toBe("busy"));
      expect(owner.events.at(-1)).toMatchObject({ type: "lease.state", state: "owned" });
      expect(observer.events.at(-1)).toMatchObject({ type: "lease.state", state: "busy", activeSession: { platform: "web", mediaId: 5 } });
      expect(JSON.stringify(observer.events)).not.toMatch(/"viewerId"|"sessionId"|"clientIp"/);
      observer.socket.send(JSON.stringify({ type: "session.bind", version: 1, sessionId }));
      await vi.waitFor(() => expect(observer.events.some((event) => event.code === "PLAYBACK_NOT_OWNER")).toBe(true));
      owner.socket.send(JSON.stringify({ type: "session.bind", version: 1, sessionId }));
      await vi.waitFor(() => expect(owner.events.filter((event) => event.type === "lease.state").length).toBe(3));
      const state = (sequence) => ({ type: "playback.state", version: 1, sessionId, mediaId: 5, action: "play", position: 12, duration: 30, loopMode: "none", shuffleEnabled: false, sequence });
      observer.socket.send(JSON.stringify(state(1)));
      await vi.waitFor(() => expect(observer.events.filter((event) => event.code === "PLAYBACK_NOT_OWNER").length).toBe(2));
      owner.socket.send(JSON.stringify(state(1)));
      await vi.waitFor(() => expect(observer.events.at(-1)?.activeSession?.playback?.position).toBe(12));
      owner.socket.send(JSON.stringify(state(0)));
      await vi.waitFor(() => expect(owner.events.some((event) => event.code === "PLAYBACK_NOT_OWNER")).toBe(true));
      const previousRevision = owner.events.filter((event) => event.type === "lease.state").at(-1).revision;
      store.set("stream:exclusive:standard", JSON.stringify({ viewerId: ownerId, sessionId: "n".repeat(32), clientIp: "192.0.2.1", mediaId: 5, platform: "web", deviceLabel: "Web" }));
      await app.playbackSocketHub.notify();
      await vi.waitFor(() => expect(owner.events.at(-1)).toMatchObject({ state: "owned", revision: previousRevision + 1 }));
      expect(owner.events).toContainEqual(expect.objectContaining({
        code: "PLAYBACK_LEASE_LOST",
        sessionId,
      }));
      // A revoked old session must not make the same viewer's new lease look remote.
      owner.socket.send(JSON.stringify(state(2)));
      await vi.waitFor(() => expect(owner.events.filter((event) => event.code === "PLAYBACK_NOT_OWNER").length).toBe(2));
      const release = await app.inject({ method: "DELETE", url: "/api/playback/lease/admin" });
      expect(release.statusCode).toBe(200);
      expect(release.json().released).toBe(true);
      await vi.waitFor(() => expect(observer.events.at(-1)?.state).toBe("available"));
      expect(observer.events.at(-1)).toMatchObject({ type: "lease.state", state: "available" });
    } finally {
      owner.socket.close();
      observer.socket.close();
      await app.close();
    }
  });
});
