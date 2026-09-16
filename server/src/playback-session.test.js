import { describe, expect, it } from "vitest";
import {
  acquireExclusiveLease,
  createPlaybackSession,
  getExclusiveLease,
  parseCookies,
  playbackCookieName,
  refreshExclusiveLease,
  releaseExclusiveLease,
  validatePlaybackSession,
} from "./playback-session.js";

function memoryRedis() {
  const values = new Map();
  const expiresAt = new Map();
  return {
    async get(key) { return values.get(key) || null; },
    async set(key, value) { values.set(key, value); return "OK"; },
    async del(key) { expiresAt.delete(key); return values.delete(key) ? 1 : 0; },
    async pttl(key) { return expiresAt.has(key) ? expiresAt.get(key) - Date.now() : -1; },
    async eval(script, keyCount, key, ...args) {
      if (script.includes("previousSessionId")) {
        const current = values.has(key) ? JSON.parse(values.get(key)) : null;
        if (current && current.viewerId !== args[0]) {
          return [0, Math.max(0, expiresAt.get(key) - Date.now())];
        }
        values.set(key, args[1]);
        expiresAt.set(key, Date.now() + Number(args[2]));
        return [1, Number(args[2]), current?.sessionId || ""];
      }
      if (script.includes("lastHeartbeatAt")) {
        const current = values.has(key) ? JSON.parse(values.get(key)) : null;
        if (!current || current.viewerId !== args[0] || current.sessionId !== args[1]) return [0, -2];
        current.lastHeartbeatAt = Number(args[2]);
        values.set(key, JSON.stringify(current));
        expiresAt.set(key, Date.now() + Number(args[3]));
        return [1, Number(args[3])];
      }
      const current = values.has(key) ? JSON.parse(values.get(key)) : null;
      if (!current || current.viewerId !== args[0] || (args[1] && current.sessionId !== args[1])) return 0;
      values.delete(key);
      expiresAt.delete(key);
      return 1;
    },
  };
}

describe("protected playback sessions", () => {
  it("binds an opaque session to media, client, tier, quality, and source version", async () => {
    const redis = memoryRedis();
    const created = await createPlaybackSession(redis, {
      mediaId: 7,
      clientIp: "192.168.1.4",
      accessTier: 2,
      quality: "high",
      sourceVersion: 3,
      duration: 120,
    });

    expect(created.sessionId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    await expect(validatePlaybackSession(redis, created.sessionId, {
      mediaId: 7,
      clientIp: "192.168.1.4",
      accessTier: 2,
      quality: "high",
      sourceVersion: 3,
    })).resolves.toMatchObject({ valid: true });
    await expect(validatePlaybackSession(redis, created.sessionId, {
      mediaId: 8,
      clientIp: "192.168.1.4",
      accessTier: 2,
      quality: "high",
      sourceVersion: 3,
    })).resolves.toEqual({ valid: false, reason: "mismatch" });
  });

  it("parses the per-media cookie without accepting malformed encoding", () => {
    expect(playbackCookieName(12)).toBe("pfs_stream_12");
    expect(parseCookies("theme=dark; pfs_stream_12=session%2Did; broken=%E0%A4%A")).toMatchObject({
      theme: "dark",
      pfs_stream_12: "session-id",
      broken: "%E0%A4%A",
    });
  });

  it("allows one viewer, renews its lease, and rejects a competing viewer", async () => {
    const redis = memoryRedis();
    const first = await acquireExclusiveLease(redis, {
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
      sessionId: "session_aaaaaaaaaaaaaaaaaaa",
      mediaId: 1,
      clientIp: "192.168.1.2",
      platform: "web",
    });
    expect(first.acquired).toBe(true);

    const competing = await acquireExclusiveLease(redis, {
      viewerId: "viewer_bbbbbbbbbbbbbbbbbbbb",
      sessionId: "session_bbbbbbbbbbbbbbbbbbb",
      mediaId: 2,
      clientIp: "192.168.1.2",
      platform: "mobile",
    });
    expect(competing).toMatchObject({ acquired: false });
    expect(competing.retryAfter).toBeGreaterThan(0);

    await expect(refreshExclusiveLease(
      redis,
      "viewer_aaaaaaaaaaaaaaaaaaaa",
      "session_aaaaaaaaaaaaaaaaaaa"
    )).resolves.toMatchObject({ refreshed: true });
    await expect(getExclusiveLease(redis)).resolves.toMatchObject({ mediaId: 1, platform: "web" });
    await expect(releaseExclusiveLease(
      redis,
      "viewer_aaaaaaaaaaaaaaaaaaaa",
      "session_aaaaaaaaaaaaaaaaaaa"
    )).resolves.toBe(true);
    await expect(getExclusiveLease(redis)).resolves.toBeNull();
  });

  it("lets the same viewer replace its session and exposes the old session for revocation", async () => {
    const redis = memoryRedis();
    await acquireExclusiveLease(redis, {
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
      sessionId: "session_aaaaaaaaaaaaaaaaaaa",
      mediaId: 1,
      clientIp: "192.168.1.2",
    });
    const replacement = await acquireExclusiveLease(redis, {
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
      sessionId: "session_ccccccccccccccccccc",
      mediaId: 3,
      clientIp: "192.168.1.2",
    });
    expect(replacement).toMatchObject({
      acquired: true,
      previousSessionId: "session_aaaaaaaaaaaaaaaaaaa",
    });
  });
});
