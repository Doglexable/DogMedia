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

  it("uses the first valid address from a forwarded chain", () => {
    const ip = getClientIp({
      headers: { "x-forwarded-for": "10.0.0.12, 127.0.0.1" },
      ip: "127.0.0.1",
      raw: { socket: { remoteAddress: "127.0.0.1" } },
    });

    expect(ip).toBe("10.0.0.12");
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

describe("auth cache", () => {
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
});
