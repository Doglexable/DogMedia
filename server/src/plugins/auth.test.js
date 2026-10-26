import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createHash } from "node:crypto";
import authPlugin, { getClientIp } from "./auth.js";
import { hashPassword } from "../password.js";

function createApp() {
  const users = [];
  const sessions = new Map();
  const app = Fastify();
  const query = async (sql, params = []) => {
    if (sql.includes("INSERT INTO users")) {
      if (users.some((user) => user.username.toLowerCase() === params[0].toLowerCase())) {
        const error = new Error("duplicate"); error.code = "23505"; throw error;
      }
      const user = { id: users.length + 1, username: params[0], password_hash: params[1], access_tier: 0, profile_picture: "fine", session_version: 0 };
      users.push(user);
      return { rows: [user] };
    }
    if (sql.includes("lower(username)")) return { rows: users.filter((user) => user.username.toLowerCase() === params[0].toLowerCase()) };
    if (sql.includes("FROM users WHERE id")) return { rows: users.filter((user) => String(user.id) === String(params[0])) };
    if (sql.includes("UPDATE users")) {
      const idParam = params.length >= 4 ? params[3] : params[2];
      const duplicate = users.some((u) => u.username.toLowerCase() === params[0].toLowerCase() && String(u.id) !== String(idParam));
      if (duplicate) {
        const error = new Error("duplicate"); error.code = "23505"; throw error;
      }
      const user = users.find((u) => String(u.id) === String(idParam));
      if (user) {
        user.username = params[0];
        user.password_hash = params[1];
        if (params.length >= 4) user.profile_picture = params[2];
        if (sql.includes("session_version = session_version + 1")) {
          user.session_version = (user.session_version ?? 0) + 1;
        }
        return { rows: [user] };
      }
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  app.decorate("pg", { query, async connect() { return { query, release() {} }; } });
  app.decorate("redis", {
    async get(key) { return sessions.get(key) || null; },
    async set(key, value) { sessions.set(key, value); },
    async del(key) { sessions.delete(key); },
    async incr(key) { const count = Number(sessions.get(key) || 0) + 1; sessions.set(key, count); return count; },
    async expire() {},
  });
  return { app, users, sessions };
}

describe("account authentication", () => {
  it("trusts forwarded IP only from the local proxy", () => {
    expect(getClientIp({ ip: "127.0.0.1", raw: { socket: { remoteAddress: "127.0.0.1" } }, headers: { "x-forwarded-for": "127.0.0.1, 203.0.113.8" } })).toBe("203.0.113.8");
    expect(getClientIp({ ip: "203.0.113.8", raw: { socket: { remoteAddress: "203.0.113.8" } }, headers: { "x-forwarded-for": "127.0.0.1" } })).toBe("203.0.113.8");
  });

  it("uses the seeded administrator and isolates registered accounts", async () => {
    const { app, users } = createApp();
    users.push({ id: 1, username: "admin", password_hash: await hashPassword("a secure password"), access_tier: 999 });
    await app.register(async (instance) => {
      await authPlugin(instance);
      instance.get("/check-access", async (request) => ({ username: request.user.username, tier: request.accessTier, identity: request.clientIp, networkIp: request.networkIp }));
    }, { prefix: "/api" });
    expect((await app.inject("/api/check-access")).statusCode).toBe(401);
    const admin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "a secure password" } });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().user.tier).toBe(999);
    expect(admin.headers["set-cookie"]).toContain("HttpOnly");
    const user = await app.inject({ method: "POST", url: "/api/auth/register", headers: { "x-forwarded-for": "203.0.113.8" }, payload: { username: "viewer", password: "another secure password" } });
    expect(user.statusCode).toBe(201);
    expect(user.json().user.tier).toBe(0);
    expect(users).toHaveLength(2);
    const adminAccess = await app.inject({ url: "/api/check-access", headers: { Authorization: `Bearer ${admin.json().token}` }, remoteAddress: "203.0.113.5" });
    const userAccess = await app.inject({ url: "/api/check-access", headers: { Authorization: `Bearer ${user.json().token}` }, remoteAddress: "203.0.113.5" });
    expect(adminAccess.json()).toMatchObject({ username: "admin", tier: 999, identity: "fd50::1" });
    expect(userAccess.json()).toMatchObject({ username: "viewer", tier: 0, identity: "fd50::2" });
    await app.close();
  });

  it("accepts the HttpOnly cookie on same-origin requests and blocks cross-site use", async () => {
    const { app } = createApp();
    await app.register(async (instance) => {
      await authPlugin(instance);
      instance.get("/private", async () => ({ ok: true }));
    }, { prefix: "/api" });
    const created = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "admin", password: "a secure password" } });
    const cookie = created.headers["set-cookie"].split(";", 1)[0];
    expect((await app.inject({ url: "/api/private", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/private", headers: { cookie, origin: "https://evil.example" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/private", headers: { cookie } })).statusCode).toBe(401);
    await app.close();
  });

  it("rejects bad credentials and expires a session on logout", async () => {
    const { app } = createApp();
    await app.register(async (instance) => {
      await authPlugin(instance);
      instance.get("/private", async () => ({ ok: true }));
    }, { prefix: "/api" });
    await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "admin", password: "a secure password" } });
    expect((await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "wrong password" } })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "ADMIN", password: "a secure password" } });
    expect(login.statusCode).toBe(200);
    const headers = { Authorization: `Bearer ${login.json().token}` };
    expect((await app.inject({ url: "/api/private", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/private", headers })).statusCode).toBe(401);
    await app.close();
  });

  it("updates user profile including username and password", async () => {
    const { app } = createApp();
    await app.register(async (instance) => {
      await authPlugin(instance);
    }, { prefix: "/api" });
    const reg = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "userone", password: "initial password 123" } });
    const token = reg.json().token;
    const headers = { Authorization: `Bearer ${token}` };

    const profileRes = await app.inject({ url: "/api/auth/profile", headers });
    expect(profileRes.statusCode).toBe(200);
    expect(profileRes.json().user.username).toBe("userone");

    // Updating username and profile picture
    const updateUsername = await app.inject({
      method: "PUT",
      url: "/api/auth/profile",
      headers,
      payload: { username: "userupdated", profile_picture: "monoco_good" },
    });
    expect(updateUsername.statusCode).toBe(200);
    expect(updateUsername.json().user.username).toBe("userupdated");
    expect(updateUsername.json().user.profile_picture).toBe("monoco_good");

    // Updating password with wrong current password should fail
    const wrongPass = await app.inject({
      method: "PUT",
      url: "/api/auth/profile",
      headers,
      payload: { password: "new super secret password", currentPassword: "wrong" },
    });
    expect(wrongPass.statusCode).toBe(400);

    // Updating password with correct current password succeeds
    const correctPass = await app.inject({
      method: "PUT",
      url: "/api/auth/profile",
      headers,
      payload: { password: "new super secret password", currentPassword: "initial password 123" },
    });
    expect(correctPass.statusCode).toBe(200);

    // Can log in with new password
    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "userupdated", password: "new super secret password" },
    });
    expect(newLogin.statusCode).toBe(200);

    await app.close();
  });

  it("revokes older sessions on password change while keeping initiating token and allowing legacy tokens", async () => {
    const { app } = createApp();
    await app.register(async (instance) => {
      await authPlugin(instance);
    }, { prefix: "/api" });

    // Register user
    const reg = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "multisession", password: "initial password 123" },
    });
    const token1 = reg.json().token;

    // Login from a second device (second session)
    const login2 = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "multisession", password: "initial password 123" },
    });
    const token2 = login2.json().token;

    // Both sessions work initially
    expect((await app.inject({ url: "/api/auth/profile", headers: { Authorization: `Bearer ${token1}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/auth/profile", headers: { Authorization: `Bearer ${token2}` } })).statusCode).toBe(200);

    // Profile-picture or username only edit does NOT revoke session 2
    const updateProfile = await app.inject({
      method: "PUT",
      url: "/api/auth/profile",
      headers: { Authorization: `Bearer ${token1}` },
      payload: { username: "multisession2", profile_picture: "monoco_good" },
    });
    expect(updateProfile.statusCode).toBe(200);
    expect((await app.inject({ url: "/api/auth/profile", headers: { Authorization: `Bearer ${token1}` } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/auth/profile", headers: { Authorization: `Bearer ${token2}` } })).statusCode).toBe(200);

    // Password change through token1
    const updatePassword = await app.inject({
      method: "PUT",
      url: "/api/auth/profile",
      headers: { Authorization: `Bearer ${token1}` },
      payload: { password: "new super secret password", currentPassword: "initial password 123" },
    });
    expect(updatePassword.statusCode).toBe(200);

    // Initiating token1 still has access (200)
    const token1Profile = await app.inject({ url: "/api/auth/profile", headers: { Authorization: `Bearer ${token1}` } });
    expect(token1Profile.statusCode).toBe(200);

    // Older token2 is now revoked (401 with LOGIN_REQUIRED)
    const token2Profile = await app.inject({ url: "/api/auth/profile", headers: { Authorization: `Bearer ${token2}` } });
    expect(token2Profile.statusCode).toBe(401);
    expect(token2Profile.json()).toMatchObject({ code: "LOGIN_REQUIRED" });

    // Old password fails to log in
    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "multisession2", password: "initial password 123" },
    });
    expect(oldLogin.statusCode).toBe(401);

    // New password succeeds to log in
    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "multisession2", password: "new super secret password" },
    });
    expect(newLogin.statusCode).toBe(200);

    await app.close();
  });

  it("accepts legacy Redis session values and rejects malformed session values", async () => {
    const { app, users, sessions } = createApp();
    users.push({ id: 1, username: "legacyuser", password_hash: await hashPassword("a secure password"), access_tier: 0, profile_picture: "fine", session_version: 0 });
    await app.register(async (instance) => {
      await authPlugin(instance);
    }, { prefix: "/api" });

    // Legacy value: only userId string "1"
    const legacyToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const legacyKey = `auth:session:${createHash("sha256").update(legacyToken).digest("hex")}`;
    sessions.set(legacyKey, "1");

    const legacyRes = await app.inject({ url: "/api/auth/profile", headers: { Authorization: `Bearer ${legacyToken}` } });
    expect(legacyRes.statusCode).toBe(200);

    // Malformed value: e.g. "not-a-number", "invalid:shape:extra", etc.
    const malformedToken = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const malformedKey = `auth:session:${createHash("sha256").update(malformedToken).digest("hex")}`;
    sessions.set(malformedKey, "malformed-garbage");

    const malformedRes = await app.inject({ url: "/api/auth/profile", headers: { Authorization: `Bearer ${malformedToken}` } });
    expect(malformedRes.statusCode).toBe(401);
    expect(malformedRes.json()).toMatchObject({ code: "LOGIN_REQUIRED" });

    await app.close();
  });
});
