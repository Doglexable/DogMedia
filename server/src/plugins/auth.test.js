import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import authPlugin, { getClientIp } from "./auth.js";

describe("getClientIp", () => {
  it("uses x-forwarded-for when nginx provides a client IP", () => {
    const ip = getClientIp({
      headers: { "x-forwarded-for": "192.168.1.42" },
      ip: "127.0.0.1",
      raw: { socket: { remoteAddress: "127.0.0.1" } },
    });

    expect(ip).toBe("192.168.1.42");
  });

  it("uses the last address from a forwarded chain to prevent spoofing", () => {
    const ip = getClientIp({
      headers: { "x-forwarded-for": "127.0.0.1, 203.0.113.195" },
      ip: "127.0.0.1",
      raw: { socket: { remoteAddress: "127.0.0.1" } },
    });

    expect(ip).toBe("203.0.113.195");
  });

  it("normalizes IPv4-mapped IPv6 addresses to IPv4", () => {
    const ipFromHeader = getClientIp({
      headers: { "x-forwarded-for": "::ffff:192.168.1.5" },
      ip: "127.0.0.1",
      raw: { socket: { remoteAddress: "127.0.0.1" } },
    });
    expect(ipFromHeader).toBe("192.168.1.5");

    const ipDirect = getClientIp({
      ip: "::ffff:192.168.1.5",
      raw: { socket: { remoteAddress: "::ffff:192.168.1.5" } },
    });
    expect(ipDirect).toBe("192.168.1.5");
  });

  it("falls back to request.ip when the forwarded header is absent or invalid", () => {
    const ip = getClientIp({
      headers: { "x-forwarded-for": "unknown" },
      ip: "127.0.0.1",
      raw: { socket: { remoteAddress: "127.0.0.1" } },
    });

    expect(ip).toBe("127.0.0.1");
  });

  it("uses x-real-ip when the forwarded header is missing", () => {
    const ip = getClientIp({
      headers: { "x-real-ip": "192.168.0.213" },
      ip: "127.0.0.1",
      raw: { socket: { remoteAddress: "127.0.0.1" } },
    });

    expect(ip).toBe("192.168.0.213");
  });

  it("ignores x-forwarded-for from direct non-local clients", () => {
    const ip = getClientIp({
      headers: { "x-forwarded-for": "192.168.1.99" },
      ip: "10.0.0.50",
      raw: { socket: { remoteAddress: "10.0.0.50" } },
    });

    expect(ip).toBe("10.0.0.50");
  });
});

describe("auth cache and spoofing prevention", () => {
  it("does not repeat whitelist lookups for a cached IP and can be invalidated", async () => {
    let accessQueries = 0;
    const app = Fastify({ logger: false });
    app.decorate("pg", {
      async query(sql) {
        if (sql.includes("COUNT(*)")) return { rows: [{ cnt: 1 }] };
        if (sql.includes("masklen")) {
          accessQueries += 1;
          return { rows: [{ access_tier: 5, description: "LAN" }] };
        }
        return { rows: [] };
      },
    });
    await authPlugin(app);
    app.get("/api/test", async (request) => ({ tier: request.accessTier }));

    expect((await app.inject("/api/test")).json()).toEqual({ tier: 5 });
    expect((await app.inject("/api/test")).json()).toEqual({ tier: 5 });
    expect(accessQueries).toBe(1);
    app.clearAuthCache();
    await app.inject("/api/test");
    expect(accessQueries).toBe(2);
    await app.close();
  });

  it("does not grant admin tier 999 when remote client spoofs X-Forwarded-For: 127.0.0.1", async () => {
    const app = Fastify({ logger: false });
    app.decorate("pg", {
      async query(sql, params) {
        if (sql.includes("COUNT(*)")) return { rows: [{ cnt: 1 }] };
        if (sql.includes("masklen")) {
          if (params?.[0] === "127.0.0.1") {
            return { rows: [{ access_tier: 999, description: "Admin" }] };
          }
          if (params?.[0] === "203.0.113.195") {
            return { rows: [{ access_tier: 0, description: "External Guest" }] };
          }
        }
        return { rows: [] };
      },
    });
    await authPlugin(app);
    app.get("/api/test", async (request) => ({
      tier: request.accessTier,
      clientIp: request.clientIp,
    }));

    const res = await app.inject({
      method: "GET",
      url: "/api/test",
      headers: {
        "x-forwarded-for": "127.0.0.1, 203.0.113.195",
        "x-real-ip": "203.0.113.195",
      },
    });

    const body = res.json();
    expect(body.clientIp).toBe("203.0.113.195");
    expect(body.tier).toBe(0);
    expect(body.tier).not.toBe(999);
    await app.close();
  });

  it("blocks access to /api/whitelist when client spoofs 127.0.0.1 in X-Forwarded-For", async () => {
    const app = Fastify({ logger: false });
    app.decorate("pg", {
      async query(sql) {
        if (sql.includes("COUNT(*)")) return { rows: [{ cnt: 1 }] };
        return { rows: [] };
      },
    });
    await authPlugin(app);
    app.get("/api/whitelist", async () => ({ ok: true }));

    const res = await app.inject({
      method: "GET",
      url: "/api/whitelist",
      headers: {
        "x-forwarded-for": "127.0.0.1, 203.0.113.195",
        "x-real-ip": "203.0.113.195",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Only accessible from localhost" });
    await app.close();
  });
});
