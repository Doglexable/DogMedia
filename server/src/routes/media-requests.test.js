import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import mediaRequestsRoutes from "./media-requests.js";
import masterUsersRoutes from "./master-users.js";
import { matchesPassword } from "../password.js";

async function buildApp(tier, query = vi.fn(async () => ({ rows: [] }))) {
  const app = Fastify();
  app.decorate("pg", { query, connect: async () => ({ query, release: () => {} }) });
  app.addHook("onRequest", async (request) => {
    request.user = { id: 42, username: "listener" };
    request.accessTier = tier;
  });
  await app.register(mediaRequestsRoutes, { prefix: "/api/media-requests" });
  await app.register(masterUsersRoutes, { prefix: "/api/master/users" });
  return app;
}

describe("media request and master users routes", () => {
  it("scopes a regular user's request list and prevents status and user access changes", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const app = await buildApp(0, query);
    expect((await app.inject({ method: "GET", url: "/api/media-requests" })).statusCode).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("r.user_id = $2"), [false, 42]);
    expect((await app.inject({ method: "PATCH", url: "/api/media-requests/1/status", payload: { status: "added" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/master/users" })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: "/api/master/users/2/tier", payload: { tier: 100 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/master/users/2/reset-password" })).statusCode).toBe(403);
    await app.close();
  });

  it("accepts a valid request under the authenticated account and rejects invalid content", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 1, user_id: 42, title: "Song", status: "pending" }] }));
    const app = await buildApp(0, query);
    const response = await app.inject({ method: "POST", url: "/api/media-requests", payload: { title: " Song ", mediaType: "music", details: " Artist " } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ user_id: 42, username: "listener" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO media_requests"), [42, "Song", "music", "Artist"]);
    expect((await app.inject({ method: "POST", url: "/api/media-requests", payload: { title: " ", mediaType: "music" } })).statusCode).toBe(400);
    await app.close();
  });

  it("lets admins review and update requests, while only administrators can change user tiers", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 8, status: "added", username: "listener", access_tier: 100 }] }));
    const admin = await buildApp(100, query);
    expect((await admin.inject({ method: "GET", url: "/api/media-requests" })).statusCode).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.any(String), [true, 42]);
    expect((await admin.inject({ method: "PATCH", url: "/api/media-requests/8/status", payload: { status: "added" } })).statusCode).toBe(200);
    expect((await admin.inject({ method: "PATCH", url: "/api/master/users/2/tier", payload: { tier: 100 } })).statusCode).toBe(403);
    await admin.close();

    const owner = await buildApp(999, query);
    expect((await owner.inject({ method: "PATCH", url: "/api/master/users/2/tier", payload: { tier: 100 } })).statusCode).toBe(200);
    expect((await owner.inject({ method: "PATCH", url: "/api/master/users/42/tier", payload: { tier: 0 } })).statusCode).toBe(400);
    expect((await owner.inject({ method: "PATCH", url: "/api/master/users/2/tier", payload: { tier: 999 } })).statusCode).toBe(400);
    await owner.close();
  });

  it("rejects downgrading the last admin and allows it when another admin remains", async () => {
    let adminCount = 1;
    const query = vi.fn(async (sql, params) => {
      if (sql.includes("SELECT id, access_tier FROM users")) return { rows: [{ id: 2, access_tier: 100 }] };
      if (sql.includes("AS admin_count")) return { rows: [{ admin_count: adminCount }] };
      if (sql.includes("UPDATE users SET access_tier")) return { rows: [{ id: params[1], username: "manager", access_tier: params[0] }] };
      return { rows: [] };
    });
    const app = await buildApp(999, query);

    const blocked = await app.inject({ method: "PATCH", url: "/api/master/users/2/tier", payload: { tier: 0 } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual({ error: "At least one admin must remain" });
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE users SET access_tier"))).toBe(false);
    expect(query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK");

    adminCount = 2;
    query.mockClear();
    const allowed = await app.inject({ method: "PATCH", url: "/api/master/users/2/tier", payload: { tier: 0 } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ id: 2, access_tier: 0 });
    expect(query.mock.calls.map(([sql]) => sql)).toContain("SELECT pg_advisory_xact_lock(hashtext('pfs-user-role-change'))");
    expect(query.mock.calls.some(([sql]) => sql.includes("session_version = session_version + 1"))).toBe(true);
    expect(query.mock.calls.map(([sql]) => sql)).toContain("COMMIT");
    await app.close();
  });

  it("resets only lower-tier users with a one-time password and invalidates their sessions", async () => {
    const query = vi.fn(async (sql, params) => {
      if (sql.includes("SET password_hash")) {
        return Number(params[1]) === 2 ? { rows: [{ id: 2, username: "viewer" }] } : { rows: [] };
      }
      return { rows: [] };
    });
    const app = await buildApp(100, query);

    const reset = await app.inject({ method: "POST", url: "/api/master/users/2/reset-password" });
    expect(reset.statusCode).toBe(200);
    expect(reset.headers["cache-control"]).toBe("no-store");
    expect(reset.json()).toMatchObject({ id: 2, username: "viewer" });
    expect(reset.json().temporaryPassword).toHaveLength(32);
    const update = query.mock.calls.find(([sql]) => sql.includes("SET password_hash"));
    expect(update[0]).toContain("session_version = session_version + 1");
    expect(update[0]).toContain("access_tier < $3");
    expect(update[1].slice(1)).toEqual([2, 100]);
    expect(update[1][0]).not.toContain(reset.json().temporaryPassword);
    expect(await matchesPassword(reset.json().temporaryPassword, update[1][0])).toBe(true);

    expect((await app.inject({ method: "POST", url: "/api/master/users/42/reset-password" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/master/users/not-an-id/reset-password" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/master/users/3/reset-password" })).statusCode).toBe(404);
    await app.close();
  });
});
