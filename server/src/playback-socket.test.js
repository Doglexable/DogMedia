import { describe, expect, it, vi } from "vitest";
import { consumeSocketTicket, issueSocketTicket, playbackSessionKey, socketTicketKey } from "./playback-session.js";
import { parsePlaybackMessage, SOCKET_MAX_BYTES, socketMediaType } from "./playback-socket.js";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import playbackRoutes from "./routes/playback.js";
import { createPlaybackSocketHub } from "./playback-socket.js";
import authPlugin from "./plugins/auth.js";
import { hashPassword } from "./password.js";

describe("playback socket protocol", () => {
  it("uses the protected session MIME family for socket reports", () => {
    expect(socketMediaType({ mediaType: "video/mp4" })).toBe("video/mp4");
    expect(socketMediaType({ mediaType: "audio/mpeg" })).toBe("audio/mpeg");
    expect(socketMediaType({})).toBe("");
  });
  it("accepts only versioned bounded messages", () => {
    expect(parsePlaybackMessage(JSON.stringify({ type: "session.bind", version: 1, sessionId: "x".repeat(32) })).type).toBe("session.bind");
    expect(() => parsePlaybackMessage(JSON.stringify({ type: "session.bind", version: 2, sessionId: "x".repeat(32) }))).toThrow();
    expect(() => parsePlaybackMessage(JSON.stringify({ type: "playback.state", version: 1, position: Infinity }))).toThrow();
    expect(() => parsePlaybackMessage("x".repeat(SOCKET_MAX_BYTES + 1))).toThrow();
  });

  it("uses a hashed one-use ticket tied to the account user and session version", async () => {
    const keys = new Map();
    const redis = {
      async set(key, value, mode, ttl) { expect([mode, ttl]).toEqual(["EX", 30]); keys.set(key, value); },
      async getdel(key) { const value = keys.get(key); keys.delete(key); return value; },
    };
    const identity = { userId: 1, sessionVersion: 0, viewerId: "viewer", clientIp: "192.0.2.1", accessTier: 100 };
    const ticket = await issueSocketTicket(redis, identity);
    expect(keys.has(socketTicketKey(ticket))).toBe(true);
    expect([...keys.keys()][0]).not.toContain(ticket);
    expect(await consumeSocketTicket(redis, ticket, { id: 2, session_version: 0 })).toBeNull();
    expect(await consumeSocketTicket(redis, ticket, { id: 1, session_version: 1 })).toBeNull();
    expect(await consumeSocketTicket(redis, ticket, null)).toBeNull();
    const second = await issueSocketTicket(redis, identity);
    expect(second).not.toBe(ticket);
    expect(await consumeSocketTicket(redis, second, { id: 1, session_version: 0 })).toEqual(identity);
  });
});

describe("protected playback socket route", () => {
  it("renews a paused bound web owner past the lease TTL, but not an observer or a disconnected owner", async () => {
    const store = new Map();
    const leaseKey = "stream:exclusive:account:192.0.2.1";
    let fakeNow = 100_000;
    let leaseExpiresAt = 0;
    const renewals = vi.fn();
    const redis = {
      async set(key, value) { store.set(key, value); },
      async get(key) {
        if (key === leaseKey && fakeNow >= leaseExpiresAt) store.delete(key);
        return store.get(key) || null;
      },
      async getdel(key) { const value = store.get(key) || null; store.delete(key); return value; },
      async pttl() { return Math.max(0, leaseExpiresAt - fakeNow); },
      multi() {
        const chain = {
          set(key, value) { store.set(key, value); return chain; },
          del(key) { store.delete(key); return chain; },
          zadd() { return chain; },
          zrem() { return chain; },
          async exec() { return []; },
        };
        return chain;
      },
      async eval(_script, _keys, key, viewerId, sessionId, clientIp, now, ttl) {
        const raw = await redis.get(key);
        if (!raw) return [0, -2];
        const lease = JSON.parse(raw);
        if (lease.viewerId !== viewerId || lease.sessionId !== sessionId || lease.clientIp !== clientIp) {
          return [0, raw, await redis.pttl()];
        }
        lease.lastHeartbeatAt = now;
        store.set(key, JSON.stringify(lease));
        leaseExpiresAt = fakeNow + ttl;
        renewals();
        return [1, ttl];
      },
    };

    const pingCallbacks = new Map();
    const app = Fastify();
    await app.register(websocket);
    app.decorate("redis", redis);
    app.decorate("playbackSocketHub", createPlaybackSocketHub(app, {
      schedulePingInterval: (fn) => {
        const id = Symbol();
        pingCallbacks.set(id, fn);
        return id;
      },
      clearPingInterval: (id) => {
        pingCallbacks.delete(id);
      },
    }));
    await app.register(async (scope) => {
      scope.addHook("onRequest", async (request) => {
        request.clientIp = "192.0.2.1";
        request.accessTier = 100;
        request.user = { id: 1, username: "user", access_tier: 100, session_version: 0 };
      });
      await scope.register(playbackRoutes, { prefix: "/playback" });
    }, { prefix: "/api" });
    await app.ready();

    const sessionId = "s".repeat(32);
    const ownerId = "o".repeat(32);
    const connect = async (viewerId) => {
      const ticket = await issueSocketTicket(redis, {
        userId: 1, sessionVersion: 0, viewerId, clientIp: "192.0.2.1", accessTier: 100, platform: "web",
      });
      const socket = await app.injectWS("/api/playback/socket");
      const events = [];
      socket.on("message", (raw) => events.push(JSON.parse(raw.toString())));
      socket.send(JSON.stringify({ type: "auth", version: 1, ticket }));
      await vi.waitFor(() => expect(events.some((event) => event.type === "socket.ready")).toBe(true));
      return { socket, events };
    };

    let owner;
    let observer;
    try {
      owner = await connect(ownerId);
      observer = await connect("v".repeat(32));
      store.set(playbackSessionKey(sessionId), JSON.stringify({
        mediaId: 10, viewerId: ownerId, clientIp: "192.0.2.1", accessTier: 100, leaseRequired: true, mediaType: "audio/mpeg",
      }));
      store.set(leaseKey, JSON.stringify({
        viewerId: ownerId, sessionId, clientIp: "192.0.2.1", mediaId: 10, platform: "web",
      }));
      leaseExpiresAt = fakeNow + 30_000;

      owner.socket.send(JSON.stringify({ type: "session.bind", version: 1, sessionId }));
      await vi.waitFor(() => expect(owner.events.some((event) => event.state === "owned")).toBe(true));

      owner.socket.send(JSON.stringify({
        type: "playback.state", version: 1, sessionId, mediaId: 10,
        action: "pause", position: 12, duration: 90, loopMode: "none", shuffleEnabled: false, sequence: 1,
      }));
      await vi.waitFor(() => expect(observer.events.at(-1)?.activeSession?.playback?.action).toBe("pause"));
      expect(owner.events.some((event) => event.code === "PLAYBACK_NOT_OWNER")).toBe(false);

      for (let tick = 0; tick < 3; tick += 1) {
        fakeNow += 10_000;
        owner.socket.pong();
        observer.socket.pong();
        for (const fn of [...pingCallbacks.values()]) {
          await fn();
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(renewals.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(await redis.get(leaseKey)).not.toBeNull();
      expect(observer.events.some((event) => event.state === "available" && event.revision > 0)).toBe(false);

      const renewalCount = renewals.mock.calls.length;
      owner.socket.terminate();

      fakeNow += 31_000;
      await app.playbackSocketHub.notify();
      await vi.waitFor(() => expect(observer.events.at(-1)?.state).toBe("available"));

      expect(renewals).toHaveBeenCalledTimes(renewalCount);
      expect(await redis.get(leaseKey)).toBeNull();
      expect(observer.events.at(-1)).toMatchObject({ type: "lease.state", state: "available" });
    } finally {
      owner?.socket.close();
      observer?.socket.close();
      await app.close();
    }
  });

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
        request.user = { id: 1, username: "user", access_tier: 0, session_version: 0 };
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
    let activePlaybackReads = 0;
    let activeReadGate = null;
    const chain = { set(key, value) { store.set(key, value); return chain; }, del(key) { store.delete(key); return chain; }, zadd() { return chain; }, zrem() { return chain; }, async exec() { return []; } };
    const redis = {
      async set(key, value) { store.set(key, value); },
      async get(key) {
        if (key.startsWith("playback:active:")) {
          activePlaybackReads += 1;
          if (activeReadGate) {
            const gate = activeReadGate;
            activeReadGate = null;
            gate.entered();
            await gate.resume;
          }
        }
        return store.get(key) || null;
      },
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
        request.user = { id: 1, username: "user", access_tier: 100, session_version: 0 };
      });
      await scope.register(playbackRoutes, { prefix: "/playback" });
    }, { prefix: "/api" });
    await app.ready();
    const ownerId = "o".repeat(32);
    const otherId = "u".repeat(32);
    const sessionId = "s".repeat(32);
    const identity = (viewerId) => ({ userId: 1, sessionVersion: 0, viewerId, clientIp: "192.0.2.1", accessTier: 100, platform: "web", deviceLabel: "Web" });
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
    const secondObserver = await connect("v".repeat(32));
    let newcomerSocket;
    let releasePausedRead;
    try {
      store.set(playbackSessionKey(sessionId), JSON.stringify({ mediaId: 5, viewerId: ownerId, clientIp: "192.0.2.1", accessTier: 100, leaseRequired: true, mediaType: "video/mp4" }));
      store.set("stream:exclusive:account:192.0.2.1", JSON.stringify({ viewerId: ownerId, sessionId, clientIp: "192.0.2.1", mediaId: 5, platform: "web", deviceLabel: "Web" }));
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
      activePlaybackReads = 0;
      owner.socket.send(JSON.stringify(state(1)));
      await vi.waitFor(() => expect(observer.events.at(-1)?.activeSession?.playback?.position).toBe(12));
      await vi.waitFor(() => expect(secondObserver.events.at(-1)?.activeSession?.playback?.position).toBe(12));
      const ownerState = owner.events.at(-1);
      const observerState = observer.events.at(-1);
      const secondObserverState = secondObserver.events.at(-1);
      expect(ownerState).toMatchObject({ type: "lease.state", state: "owned" });
      expect(observerState).toMatchObject({ type: "lease.state", state: "busy" });
      expect(secondObserverState).toMatchObject({ type: "lease.state", state: "busy" });
      expect(ownerState.activeSession).toEqual(observerState.activeSession);
      expect(secondObserverState.activeSession).toEqual(observerState.activeSession);
      expect(ownerState.revision).toBe(observerState.revision);
      expect(secondObserverState.revision).toBe(observerState.revision);
      // One read precedes the playback write; the broadcast adds only one read for all three sockets.
      expect(activePlaybackReads).toBe(2);

      let markReadEntered;
      const readEntered = new Promise((resolve) => { markReadEntered = resolve; });
      const pauseRead = new Promise((resolve) => { releasePausedRead = resolve; });
      activeReadGate = { entered: markReadEntered, resume: pauseRead };
      const nextRevision = ownerState.revision + 1;
      const pendingBroadcast = app.playbackSocketHub.notify();
      await readEntered;
      const newcomerTicket = await issueSocketTicket(redis, identity("w".repeat(32)));
      newcomerSocket = await app.injectWS("/api/playback/socket");
      const newcomerEvents = [];
      newcomerSocket.on("message", (raw) => newcomerEvents.push(JSON.parse(raw.toString())));
      newcomerSocket.send(JSON.stringify({ type: "auth", version: 1, ticket: newcomerTicket }));
      await vi.waitFor(() => expect(newcomerEvents.map((event) => event.type)).toEqual(["socket.ready", "lease.state"]));
      releasePausedRead();
      await pendingBroadcast;
      await vi.waitFor(() => expect(owner.events.at(-1)?.revision).toBe(nextRevision));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(newcomerEvents.filter((event) => event.type === "lease.state")).toHaveLength(1);

      owner.socket.send(JSON.stringify(state(0)));
      await vi.waitFor(() => expect(owner.events.some((event) => event.code === "PLAYBACK_NOT_OWNER")).toBe(true));
      const previousRevision = owner.events.filter((event) => event.type === "lease.state").at(-1).revision;
      store.set("stream:exclusive:account:192.0.2.1", JSON.stringify({ viewerId: ownerId, sessionId: "n".repeat(32), clientIp: "192.0.2.1", mediaId: 5, platform: "web", deviceLabel: "Web" }));
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
      releasePausedRead?.();
      owner.socket.close();
      observer.socket.close();
      secondObserver.socket.close();
      newcomerSocket?.close();
      await app.close();
    }
  });

  it("binds socket tickets to authenticated account session and revokes open socket on password change", async () => {
    const users = [];
    const redisStore = new Map();
    const query = async (sql, params = []) => {
      if (sql.includes("lower(username)")) return { rows: users.filter((u) => u.username.toLowerCase() === params[0].toLowerCase()) };
      if (sql.includes("SELECT session_version FROM users WHERE id")) {
        const user = users.find((u) => String(u.id) === String(params[0]));
        return { rows: user ? [{ session_version: user.session_version }] : [] };
      }
      if (sql.includes("FROM users WHERE id")) {
        const user = users.find((u) => String(u.id) === String(params[0]));
        return { rows: user ? [user] : [] };
      }
      if (sql.includes("UPDATE users")) {
        const idParam = params[params.length - 1];
        const user = users.find((u) => String(u.id) === String(idParam));
        if (user) {
          user.username = params[0];
          user.password_hash = params[1];
          if (params.length >= 4) user.profile_picture = params[2];
          if (params.length >= 5) user.eq_settings = typeof params[3] === "string" ? JSON.parse(params[3]) : params[3];
          if (sql.includes("session_version = session_version + 1")) {
            user.session_version = (user.session_version ?? 0) + 1;
          }
          return { rows: [user] };
        }
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    };

    const redis = {
      async set(key, value) { redisStore.set(key, value); },
      async get(key) { return redisStore.get(key) || null; },
      async getdel(key) { const val = redisStore.get(key) || null; redisStore.delete(key); return val; },
      async del(key) { return redisStore.delete(key) ? 1 : 0; },
      async pttl() { return 30_000; },
    };

    const app = Fastify();
    await app.register(websocket);
    app.decorate("redis", redis);
    app.decorate("pg", { query });
    app.decorate("playbackSocketHub", createPlaybackSocketHub(app));

    const initialPassword = "initial password 123";
    const userA = { id: 10, username: "user_a", password_hash: await hashPassword(initialPassword), access_tier: 100, profile_picture: "fine", session_version: 0 };
    const userB = { id: 20, username: "user_b", password_hash: await hashPassword(initialPassword), access_tier: 100, profile_picture: "fine", session_version: 0 };
    users.push(userA, userB);

    await app.register(async (scope) => {
      await authPlugin(scope);
      await scope.register(playbackRoutes, { prefix: "/playback" });
    }, { prefix: "/api" });

    await app.ready();

    let socketA;
    let socketB;
    try {
      const loginA = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "user_a", password: initialPassword },
      });
      expect(loginA.statusCode).toBe(200);
      const tokenA = loginA.json().token;

      const loginB = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "user_b", password: initialPassword },
      });
      expect(loginB.statusCode).toBe(200);
      const tokenB = loginB.json().token;

      const ticketResA = await app.inject({
        method: "POST",
        url: "/api/playback/socket-ticket",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(ticketResA.statusCode).toBe(200);
      const { ticket: ticketA } = ticketResA.json();

      socketB = await app.injectWS("/api/playback/socket", { headers: { authorization: `Bearer ${tokenB}` } });
      const eventsB = [];
      let closedB = false;
      socketB.on("message", (raw) => eventsB.push(JSON.parse(raw.toString())));
      socketB.on("close", () => { closedB = true; });
      socketB.send(JSON.stringify({ type: "auth", version: 1, ticket: ticketA }));
      await vi.waitFor(() => expect(closedB).toBe(true));
      expect(eventsB.length).toBe(0);

      const ticketResA2 = await app.inject({
        method: "POST",
        url: "/api/playback/socket-ticket",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      const { ticket: ticketA2 } = ticketResA2.json();

      socketA = await app.injectWS("/api/playback/socket", { headers: { authorization: `Bearer ${tokenA}` } });
      const eventsA = [];
      let closedA = false;
      socketA.on("message", (raw) => eventsA.push(JSON.parse(raw.toString())));
      socketA.on("close", () => { closedA = true; });
      socketA.send(JSON.stringify({ type: "auth", version: 1, ticket: ticketA2 }));
      await vi.waitFor(() => expect(eventsA.some((e) => e.type === "socket.ready")).toBe(true));

      const sessionId = "s".repeat(32);
      redisStore.set(playbackSessionKey(sessionId), JSON.stringify({
        mediaId: 101,
        viewerId: ticketResA2.json().viewerId,
        clientIp: "fd50::a",
        accessTier: 100,
        leaseRequired: true,
        mediaType: "audio/mpeg",
      }));
      redisStore.set("stream:exclusive:account:fd50::a", JSON.stringify({
        viewerId: ticketResA2.json().viewerId,
        sessionId,
        clientIp: "fd50::a",
        mediaId: 101,
        platform: "web",
        deviceLabel: "Web",
      }));

      const otherAccountStatus = await app.inject({
        method: "GET",
        url: "/api/playback/lease",
        headers: { authorization: `Bearer ${tokenB}` },
      });
      expect(otherAccountStatus.json()).toEqual({ state: "available", expiresIn: 0 });
      const ticketResB = await app.inject({
        method: "POST",
        url: "/api/playback/socket-ticket",
        headers: { authorization: `Bearer ${tokenB}` },
      });
      socketB = await app.injectWS("/api/playback/socket", { headers: { authorization: `Bearer ${tokenB}` } });
      const otherAccountEvents = [];
      socketB.on("message", (raw) => otherAccountEvents.push(JSON.parse(raw.toString())));
      socketB.send(JSON.stringify({ type: "auth", version: 1, ticket: ticketResB.json().ticket }));
      await vi.waitFor(() => expect(otherAccountEvents.some((event) => event.type === "lease.state" && event.state === "available")).toBe(true));

      socketA.send(JSON.stringify({ type: "session.bind", version: 1, sessionId }));
      await vi.waitFor(() => expect(eventsA.some((e) => e.state === "owned")).toBe(true));
      await app.playbackSocketHub.notify();
      expect(otherAccountEvents.at(-1)).toMatchObject({ type: "lease.state", state: "available" });
      expect(otherAccountEvents.at(-1)).not.toHaveProperty("activeSession");

      const newPassword = "new secret password 456";
      const profileRes = await app.inject({
        method: "PUT",
        url: "/api/auth/profile",
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { currentPassword: initialPassword, password: newPassword },
      });
      expect(profileRes.statusCode).toBe(200);
      expect(userA.session_version).toBe(1);

      socketA.send(JSON.stringify({
        type: "playback.state",
        version: 1,
        sessionId,
        mediaId: 101,
        action: "play",
        position: 10,
        duration: 100,
        loopMode: "none",
        shuffleEnabled: false,
        sequence: 1,
      }));

      await vi.waitFor(() => expect(eventsA.some((e) => e.code === "PLAYBACK_NOT_OWNER")).toBe(true));
      await vi.waitFor(() => expect(closedA).toBe(true));
    } finally {
      socketA?.close();
      socketB?.close();
      await app.close();
    }
  });

  it("excludes observers from renewing leases and notifies available on owner disconnect or lease expiry", async () => {
    const store = new Map();
    const redis = {
      async set(key, value) { store.set(key, value); },
      async get(key) { return store.get(key) || null; },
      async getdel(key) { const val = store.get(key) || null; store.delete(key); return val; },
      async del(key) { return store.delete(key) ? 1 : 0; },
      async pttl() { return 30_000; },
    };
    const app = Fastify();
    await app.register(websocket);
    app.decorate("redis", redis);
    app.decorate("playbackSocketHub", createPlaybackSocketHub(app));

    await app.register(async (scope) => {
      scope.addHook("onRequest", async (request) => {
        request.clientIp = "192.0.2.1";
        request.accessTier = 100;
        request.user = { id: 1, username: "user", access_tier: 100, session_version: 0 };
      });
      await scope.register(playbackRoutes, { prefix: "/playback" });
    }, { prefix: "/api" });

    await app.ready();

    const ownerViewerId = "owner-viewer-1234567890123456789";
    const observerViewerId = "observer-viewer-12345678901234567";
    const sessionId = "session-12345678901234567890123456";

    let ownerSocket;
    let observerSocket;
    try {
      const ownerTicket = await issueSocketTicket(redis, {
        userId: 1, sessionVersion: 0, viewerId: ownerViewerId, clientIp: "192.0.2.1", accessTier: 100, platform: "web", deviceLabel: "Owner Web",
      });
      const observerTicket = await issueSocketTicket(redis, {
        userId: 1, sessionVersion: 0, viewerId: observerViewerId, clientIp: "192.0.2.1", accessTier: 100, platform: "web", deviceLabel: "Observer Web",
      });

      ownerSocket = await app.injectWS("/api/playback/socket");
      const ownerEvents = [];
      ownerSocket.on("message", (raw) => ownerEvents.push(JSON.parse(raw.toString())));
      ownerSocket.send(JSON.stringify({ type: "auth", version: 1, ticket: ownerTicket }));
      await vi.waitFor(() => expect(ownerEvents.some((e) => e.type === "socket.ready")).toBe(true));

      observerSocket = await app.injectWS("/api/playback/socket");
      const observerEvents = [];
      observerSocket.on("message", (raw) => observerEvents.push(JSON.parse(raw.toString())));
      observerSocket.send(JSON.stringify({ type: "auth", version: 1, ticket: observerTicket }));
      await vi.waitFor(() => expect(observerEvents.some((e) => e.type === "socket.ready")).toBe(true));

      store.set(playbackSessionKey(sessionId), JSON.stringify({
        mediaId: 10, viewerId: ownerViewerId, clientIp: "192.0.2.1", accessTier: 100, leaseRequired: true, mediaType: "video/mp4",
      }));
      store.set("stream:exclusive:account:192.0.2.1", JSON.stringify({
        viewerId: ownerViewerId, sessionId, clientIp: "192.0.2.1", mediaId: 10, platform: "web", deviceLabel: "Owner Web",
      }));

      await app.playbackSocketHub.notify();
      await vi.waitFor(() => expect(ownerEvents.at(-1)?.state).toBe("owned"));
      await vi.waitFor(() => expect(observerEvents.at(-1)?.state).toBe("busy"));

      // Observer tries to bind owner's session -> rejected
      observerSocket.send(JSON.stringify({ type: "session.bind", version: 1, sessionId }));
      await vi.waitFor(() => expect(observerEvents.some((e) => e.code === "PLAYBACK_NOT_OWNER")).toBe(true));

      // Owner disconnects / releases lease
      store.delete("stream:exclusive:account:192.0.2.1");
      ownerSocket.close();
      await app.playbackSocketHub.notify();

      // Observer receives available state
      await vi.waitFor(() => expect(observerEvents.at(-1)?.state).toBe("available"));
      expect(observerEvents.at(-1)).toMatchObject({ type: "lease.state", state: "available" });
    } finally {
      ownerSocket?.close();
      observerSocket?.close();
      await app.close();
    }
  });
});
