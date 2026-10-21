import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createMediaAccess, requirePrivateApiAccess } from "./media-access.js";
import { isAllowedMediaBrowserRequest } from "./media-request-boundary.js";
import mediaRoutes from "./routes/media.js";

function fakeRedis() {
  const values = new Map();
  return {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, String(value)); },
    async del(key) { values.delete(key); },
    async incr(key) { const next = Number(values.get(key) || 0) + 1; values.set(key, String(next)); return next; },
    async expire() {},
  };
}

describe("private media access", () => {
  it("requires a sufficiently long server key", () => {
    expect(() => createMediaAccess({ redis: fakeRedis(), secret: "short" })).toThrow(/24 characters/);
  });

  it("denies direct requests, then accepts a valid browser session or native bearer key", async () => {
    const secret = "unique-media-access-password-123456";
    const access = createMediaAccess({ redis: fakeRedis(), secret });
    const app = Fastify();
    app.addHook("onRequest", async (request) => { request.clientIp = "192.0.2.10"; });
    app.post("/api/media-access/login", access.login);
    app.get("/api/media/1/thumbnail", async (request, reply) => {
      if (!await access.authorized(request)) return reply.code(401).send({ error: "Media access key required" });
      return { ok: true };
    });

    expect((await app.inject("/api/media/1/thumbnail")).statusCode).toBe(401);
    const invalid = await app.inject({ method: "POST", url: "/api/media-access/login", payload: { password: "wrong" } });
    expect(invalid.statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/media-access/login", headers: { "sec-fetch-site": "cross-site" }, payload: { password: secret } })).statusCode).toBe(403);
    const login = await app.inject({ method: "POST", url: "/api/media-access/login", payload: { password: secret } });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toContain("HttpOnly; SameSite=Strict");
    const cookie = login.headers["set-cookie"].split(";", 1)[0];
    expect((await app.inject({ url: "/api/media/1/thumbnail", headers: { cookie } })).statusCode).toBe(200);
    expect(await access.authorized({ headers: { cookie }, clientIp: "192.0.2.11" })).toBe(false);
    expect((await app.inject({ url: "/api/media/1/thumbnail", headers: { authorization: `Bearer ${secret}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/media/1/thumbnail", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    await app.close();
  });

  it("rejects cross-site browser loads and top-level media navigation", () => {
    expect(isAllowedMediaBrowserRequest({ protocol: "https", headers: { host: "media.example", "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" } })).toBe(false);
    expect(isAllowedMediaBrowserRequest({ protocol: "https", headers: { host: "media.example", "sec-fetch-site": "none", "sec-fetch-mode": "navigate" } })).toBe(false);
    expect(isAllowedMediaBrowserRequest({ protocol: "https", headers: { host: "media.example", "sec-fetch-site": "same-origin", "sec-fetch-mode": "no-cors" } })).toBe(true);
  });

  it("guards the actual media plugin before route validation", async () => {
    const secret = "unique-media-access-password-123456";
    const app = Fastify();
    app.decorate("pg", { async query() { throw new Error("database should not be queried"); } });
    app.addHook("onRequest", async (request) => { request.clientIp = "192.0.2.10"; request.accessTier = 100; });
    await app.register(mediaRoutes, {
      prefix: "/api/media",
      mediaAccess: createMediaAccess({ redis: fakeRedis(), secret }),
    });
    expect((await app.inject("/api/media/invalid")).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/media/invalid", headers: { authorization: `Bearer ${secret}` } })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/media/invalid", headers: { authorization: `Bearer ${secret}`, "sec-fetch-site": "cross-site" } })).statusCode).toBe(403);
    await app.close();
  });

  it("gates other private routes before handlers while leaving access discovery available", async () => {
    const secret = "unique-media-access-password-123456";
    const app = Fastify();
    app.addHook("onRequest", async (request) => { request.clientIp = "192.0.2.10"; });
    await app.register(async (instance) => {
      instance.addHook("onRequest", requirePrivateApiAccess(createMediaAccess({ redis: fakeRedis(), secret })));
      instance.get("/check-access", async () => ({ tier: 100 }));
      instance.get("/categories", async () => ({ items: [] }));
      instance.get("/media/1/thumbnail", async () => ({ ok: true }));
    }, { prefix: "/api" });
    expect((await app.inject("/api/check-access")).statusCode).toBe(200);
    expect((await app.inject("/api/categories")).statusCode).toBe(401);
    expect((await app.inject("/api/media/1/thumbnail")).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/categories", headers: { authorization: `Bearer ${secret}` } })).statusCode).toBe(200);
    await app.close();
  });
});
