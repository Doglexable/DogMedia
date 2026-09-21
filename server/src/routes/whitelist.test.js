import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import authPlugin from "../plugins/auth.js";
import whitelistRoutes from "./whitelist.js";

function createMockPg({ rows = [], rowCount = 1 } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes("COUNT(*)")) {
        return { rows: [{ cnt: rows.length }] };
      }
      if (sql.includes("SELECT * FROM ip_whitelist")) {
        return { rows };
      }
      if (sql.includes("INSERT INTO ip_whitelist")) {
        const [cidrRange, accessTier, description] = params;
        return {
          rows: [
            {
              id: 99,
              cidr_range: cidrRange,
              access_tier: accessTier,
              description,
            },
          ],
        };
      }
      if (sql.includes("DELETE FROM ip_whitelist")) {
        return { rowCount };
      }
      if (sql.includes("masklen")) {
        return { rows: [{ access_tier: 100, description: "Home Network" }] };
      }
      return { rows: [] };
    },
  };
}

async function buildApp({ pg, onClearAuthCache } = {}) {
  const app = Fastify({ logger: false });
  app.decorate("pg", pg || createMockPg());

  await app.register(async function (instance) {
    await authPlugin(instance);
    if (onClearAuthCache) {
      const orig = instance.clearAuthCache;
      instance.clearAuthCache = () => {
        onClearAuthCache();
        return orig();
      };
    }
    await instance.register(whitelistRoutes, { prefix: "/whitelist" });
  }, { prefix: "/api" });

  await app.ready();
  return app;
}

describe("whitelist routes authorization gates", () => {
  it("rejects remote IP requesting GET /api/whitelist with 403 Forbidden", async () => {
    const app = await buildApp();

    const directRes = await app.inject({
      method: "GET",
      url: "/api/whitelist",
      remoteAddress: "192.168.1.50",
    });
    expect(directRes.statusCode).toBe(403);
    expect(directRes.json()).toEqual({ error: "Only accessible from localhost" });

    const proxiedRes = await app.inject({
      method: "GET",
      url: "/api/whitelist",
      headers: {
        "x-forwarded-for": "192.168.1.50",
      },
    });
    expect(proxiedRes.statusCode).toBe(403);
    expect(proxiedRes.json()).toEqual({ error: "Only accessible from localhost" });

    await app.close();
  });

  it("rejects remote IP requesting GET /api/%77hitelist or GET /api/./whitelist with 403 Forbidden", async () => {
    const app = await buildApp();

    const encodedRes = await app.inject({
      method: "GET",
      url: "/api/%77hitelist",
      remoteAddress: "192.168.1.50",
    });
    expect(encodedRes.statusCode).toBe(403);
    expect(encodedRes.json()).toEqual({ error: "Only accessible from localhost" });

    const pathTraversalRes = await app.inject({
      method: "GET",
      url: "/api/./whitelist",
      remoteAddress: "192.168.1.50",
    });
    expect(pathTraversalRes.statusCode).toBe(403);
    expect(pathTraversalRes.json()).toEqual({ error: "Only accessible from localhost" });

    await app.close();
  });

  it("rejects remote IP requesting POST /api/%77hitelist with 403 Forbidden", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/%77hitelist",
      remoteAddress: "192.168.1.50",
      payload: {
        cidr_range: "10.0.0.0/8",
        access_tier: 999,
        description: "Bypassed Admin",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Only accessible from localhost" });

    await app.close();
  });

  it("enforces route-level preHandler localhost check independently on whitelistRoutes", async () => {
    const app = Fastify({ logger: false });
    app.decorate("pg", createMockPg({
      rows: [{ id: 1, cidr_range: "127.0.0.1/32", access_tier: 999, description: "Localhost" }],
    }));
    await app.register(whitelistRoutes, { prefix: "/api/whitelist" });
    await app.ready();

    const remoteRes = await app.inject({
      method: "GET",
      url: "/api/whitelist",
      remoteAddress: "192.168.1.50",
    });
    expect(remoteRes.statusCode).toBe(403);
    expect(remoteRes.json()).toEqual({ error: "Only accessible from localhost" });

    const localRes = await app.inject({
      method: "GET",
      url: "/api/whitelist",
      remoteAddress: "127.0.0.1",
    });
    expect(localRes.statusCode).toBe(200);
    expect(localRes.json()).toEqual([
      { id: 1, cidr_range: "127.0.0.1/32", access_tier: 999, description: "Localhost" },
    ]);

    await app.close();
  });

  it("allows localhost (127.0.0.1, ::1, ::ffff:127.0.0.1) requesting GET /api/whitelist and returns rows", async () => {
    const mockRows = [
      { id: 1, cidr_range: "127.0.0.1/32", access_tier: 999, description: "Admin Localhost" },
      { id: 2, cidr_range: "192.168.1.0/24", access_tier: 100, description: "Home LAN" },
    ];
    const app = await buildApp({ pg: createMockPg({ rows: mockRows }) });

    const resV4 = await app.inject({
      method: "GET",
      url: "/api/whitelist",
      remoteAddress: "127.0.0.1",
    });
    expect(resV4.statusCode).toBe(200);
    expect(resV4.json()).toEqual(mockRows);

    const resV6 = await app.inject({
      method: "GET",
      url: "/api/whitelist",
      remoteAddress: "::1",
    });
    expect(resV6.statusCode).toBe(200);
    expect(resV6.json()).toEqual(mockRows);

    const resV4Mapped = await app.inject({
      method: "GET",
      url: "/api/whitelist",
      remoteAddress: "::ffff:127.0.0.1",
    });
    expect(resV4Mapped.statusCode).toBe(200);
    expect(resV4Mapped.json()).toEqual(mockRows);

    await app.close();
  });

  it("allows localhost POST /api/whitelist to insert a new CIDR range and calls clearAuthCache", async () => {
    const clearAuthCacheSpy = vi.fn();
    const app = await buildApp({ onClearAuthCache: clearAuthCacheSpy });

    const res = await app.inject({
      method: "POST",
      url: "/api/whitelist",
      remoteAddress: "127.0.0.1",
      payload: {
        cidr_range: "10.10.0.0/16",
        access_tier: 100,
        description: "Office VPN",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: 99,
      cidr_range: "10.10.0.0/16",
      access_tier: 100,
      description: "Office VPN",
    });
    expect(clearAuthCacheSpy).toHaveBeenCalledTimes(1);

    const badRes = await app.inject({
      method: "POST",
      url: "/api/whitelist",
      remoteAddress: "127.0.0.1",
      payload: {
        description: "Missing cidr_range",
      },
    });
    expect(badRes.statusCode).toBe(400);
    expect(badRes.json()).toEqual({ error: "cidr_range is required" });

    await app.close();
  });

  it("allows localhost DELETE /api/whitelist/:id to delete entry and calls clearAuthCache", async () => {
    const clearAuthCacheSpy = vi.fn();
    const app = await buildApp({
      pg: createMockPg({ rowCount: 1 }),
      onClearAuthCache: clearAuthCacheSpy,
    });

    const res = await app.inject({
      method: "DELETE",
      url: "/api/whitelist/12",
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(204);
    expect(clearAuthCacheSpy).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("returns 404 when deleting a non-existent whitelist entry", async () => {
    const clearAuthCacheSpy = vi.fn();
    const app = await buildApp({
      pg: createMockPg({ rowCount: 0 }),
      onClearAuthCache: clearAuthCacheSpy,
    });

    const res = await app.inject({
      method: "DELETE",
      url: "/api/whitelist/999",
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Not found" });
    expect(clearAuthCacheSpy).not.toHaveBeenCalled();

    await app.close();
  });
});
