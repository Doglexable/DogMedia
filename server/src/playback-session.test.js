import { describe, expect, it } from "vitest";
import {
  acquireExclusiveLease,
  createPlaybackSession,
  forceReleaseExclusiveLease,
  getExclusiveLease,
  normalizeDeviceLabel,
  parseCookies,
  playbackCookieName,
  publicLeaseHolder,
  readPlaybackClientId,
  refreshExclusiveLease,
  releaseExclusiveLease,
  requiresExclusiveLease,
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
        const currentClientId = current?.clientId || current?.viewerId;
        if (current && (current.viewerId !== args[0] || current.clientIp !== args[1] || (args[4] && currentClientId !== args[4]))) {
          const ttl = Math.max(0, (expiresAt.get(key) ?? Date.now()) - Date.now());
          return [0, JSON.stringify(current), ttl];
        }
        values.set(key, args[2]);
        expiresAt.set(key, Date.now() + Number(args[3]));
        return [1, Number(args[3]), current?.sessionId || ""];
      }
      if (script.includes("lastHeartbeatAt")) {
        const current = values.has(key) ? JSON.parse(values.get(key)) : null;
        if (!current) return [0, -2];
        if (current.viewerId !== args[0] || current.sessionId !== args[1] || current.clientIp !== args[2]) {
          const ttl = Math.max(0, (expiresAt.get(key) ?? Date.now()) - Date.now());
          return [0, JSON.stringify(current), ttl];
        }
        current.lastHeartbeatAt = Number(args[3]);
        values.set(key, JSON.stringify(current));
        expiresAt.set(key, Date.now() + Number(args[4]));
        return [1, Number(args[4])];
      }
      const current = values.has(key) ? JSON.parse(values.get(key)) : null;
      if (!current || current.viewerId !== args[0] || (args[1] && current.sessionId !== args[1]) || current.clientIp !== args[2]) return 0;
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
      mediaType: "video/mp4",
      sourceVersion: 3,
      duration: 120,
    });
    expect(created.session.mediaType).toBe("video/mp4");

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

  it("allows one account lease, renews it, and rejects a second device on that account", async () => {
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
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
      sessionId: "session_bbbbbbbbbbbbbbbbbbb",
      mediaId: 2,
      clientIp: "192.168.1.2",
      clientId: "other_device_aaaaaaaaaaaa",
      platform: "mobile",
    });
    expect(competing).toMatchObject({ acquired: false });
    expect(competing.retryAfter).toBeGreaterThan(0);

    await expect(refreshExclusiveLease(
      redis,
      "viewer_aaaaaaaaaaaaaaaaaaaa",
      "session_aaaaaaaaaaaaaaaaaaa",
      "192.168.1.2"
    )).resolves.toMatchObject({ refreshed: true });
    await expect(getExclusiveLease(redis, "192.168.1.2")).resolves.toMatchObject({ mediaId: 1, platform: "web" });
    await expect(releaseExclusiveLease(
      redis,
      "viewer_aaaaaaaaaaaaaaaaaaaa",
      "session_aaaaaaaaaaaaaaaaaaa",
      "192.168.1.2"
    )).resolves.toBe(true);
    await expect(getExclusiveLease(redis, "192.168.1.2")).resolves.toBeNull();
  });

  it("lets the same viewer on the same IP rotate sessions and exposes the old session for revocation", async () => {
    const redis = memoryRedis();
    await acquireExclusiveLease(redis, {
      viewerId: "viewer_bbbbbbbbbbbbbbbbbbbb",
      sessionId: "session_aaaaaaaaaaaaaaaaaaa",
      mediaId: 1,
      clientIp: "192.168.1.2",
    });
    const replacement = await acquireExclusiveLease(redis, {
      viewerId: "viewer_bbbbbbbbbbbbbbbbbbbb",
      sessionId: "session_ccccccccccccccccccc",
      mediaId: 3,
      clientIp: "192.168.1.2",
    });
    expect(replacement).toMatchObject({
      acquired: true,
      previousSessionId: "session_aaaaaaaaaaaaaaaaaaa",
    });
    expect(replacement.holder).toBeNull();
  });

  it("rejects a different viewer on the same IP and reports the original holder", async () => {
    const redis = memoryRedis();
    await acquireExclusiveLease(redis, {
      viewerId: "viewer_bbbbbbbbbbbbbbbbbbbb",
      sessionId: "session_aaaaaaaaaaaaaaaaaaa",
      mediaId: 1,
      clientIp: "192.168.1.2",
      platform: "desktop",
      deviceLabel: "My Desktop",
    });
    const competing = await acquireExclusiveLease(redis, {
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
      sessionId: "session_ccccccccccccccccccc",
      mediaId: 3,
      clientIp: "192.168.1.2",
      platform: "web",
    });
    expect(competing.acquired).toBe(false);
    expect(competing.retryAfter).toBeGreaterThan(0);
    expect(competing.previousSessionId).toBeNull();
    expect(competing.holder).toMatchObject({
      sessionId: "session_aaaaaaaaaaaaaaaaaaa",
      mediaId: 1,
      platform: "desktop",
    });
    // The reported holder is the original owner, never the new attempt.
    expect(competing.holder.sessionId).not.toBe("session_ccccccccccccccccccc");
    expect(competing.holder.viewerId).toBe("viewer_bbbbbbbbbbbbbbbbbbbb");
  });

  it("keeps leases independent across account scopes even when the viewer ID is reused", async () => {
    const redis = memoryRedis();
    await acquireExclusiveLease(redis, {
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
      sessionId: "session_aaaaaaaaaaaaaaaaaaa",
      mediaId: 1,
      clientIp: "192.168.1.2",
    });
    const competing = await acquireExclusiveLease(redis, {
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
      sessionId: "session_bbbbbbbbbbbbbbbbbbb",
      mediaId: 2,
      clientIp: "192.168.1.3",
    });
    expect(competing.acquired).toBe(true);
    await expect(getExclusiveLease(redis, "192.168.1.2")).resolves.toMatchObject({ sessionId: "session_aaaaaaaaaaaaaaaaaaa" });
    await expect(getExclusiveLease(redis, "192.168.1.3")).resolves.toMatchObject({ sessionId: "session_bbbbbbbbbbbbbbbbbbb" });
  });

  it("lets a different account acquire its own lease", async () => {
    const redis = memoryRedis();
    await acquireExclusiveLease(redis, {
      viewerId: "viewer_bbbbbbbbbbbbbbbbbbbb",
      sessionId: "session_aaaaaaaaaaaaaaaaaaa",
      mediaId: 1,
      clientIp: "192.168.1.2",
    });
    const competing = await acquireExclusiveLease(redis, {
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
      sessionId: "session_bbbbbbbbbbbbbbbbbbb",
      mediaId: 2,
      clientIp: "192.168.1.9",
    });
    expect(competing.acquired).toBe(true);
    await expect(getExclusiveLease(redis, "192.168.1.2")).resolves.toMatchObject({ mediaId: 1 });
    await expect(getExclusiveLease(redis, "192.168.1.9")).resolves.toMatchObject({ mediaId: 2 });
  });

  it("force releases only the selected account lease", async () => {
    const redis = memoryRedis();
    for (const [clientIp, viewerId] of [["fd50::1", "viewer_aaaaaaaaaaaaaaaaaaaa"], ["fd50::2", "viewer_bbbbbbbbbbbbbbbbbbbb"]]) {
      const result = await acquireExclusiveLease(redis, {
        viewerId,
        sessionId: `session_${viewerId}`,
        mediaId: 1,
        clientIp,
      });
      expect(result.acquired).toBe(true);
    }
    expect(await forceReleaseExclusiveLease(redis, "fd50::1")).toBe(1);
    await expect(getExclusiveLease(redis, "fd50::1")).resolves.toBeNull();
    await expect(getExclusiveLease(redis, "fd50::2")).resolves.toMatchObject({ viewerId: "viewer_bbbbbbbbbbbbbbbbbbbb" });
  });

  it("requires a lease for protected playback at every access tier", () => {
    for (const tier of [0, 100, 999, 10_000]) {
      expect(requiresExclusiveLease(tier, "audio/mpeg")).toBe(true);
      expect(requiresExclusiveLease(tier, "video/mp4")).toBe(true);
    }
    expect(requiresExclusiveLease(0, "image/jpeg")).toBe(false);
  });

  it("normalizes device labels safely with platform fallbacks", () => {
    expect(normalizeDeviceLabel("My Desktop", "desktop")).toBe("My Desktop");
    expect(normalizeDeviceLabel("  Living   Room  TV  ", "web")).toBe("Living Room TV");
    expect(normalizeDeviceLabel("", "desktop")).toBe("Dogmedia Desktop");
    expect(normalizeDeviceLabel("   ", "mobile")).toBe("Dogmedia Mobile");
    expect(normalizeDeviceLabel(null, "web")).toBe("Dogmedia Web");
    expect(normalizeDeviceLabel(42, "web")).toBe("Dogmedia Web");
    expect(normalizeDeviceLabel("Bad\u0000Name\u007F", "web")).toBe("BadName");
    expect(normalizeDeviceLabel("x".repeat(100), "web")).toHaveLength(64);
    expect(normalizeDeviceLabel("Hi", "tv")).toBe("Hi");
    expect(normalizeDeviceLabel("", "tv")).toBe("Another device");
  });

  it("builds a public holder without sensitive identifiers", () => {
    expect(publicLeaseHolder({
      platform: "desktop",
      deviceLabel: "My Desktop",
      mediaId: 42,
      viewerId: "secret-viewer",
      sessionId: "secret-session",
      clientIp: "10.0.0.1",
    }, 24)).toEqual({
      platform: "desktop",
      deviceLabel: "My Desktop",
      expiresIn: 24,
      mediaId: 42,
    });
    expect(publicLeaseHolder({ platform: "weird", mediaId: -3 }, -5)).toBeNull();
    expect(publicLeaseHolder(null, 10)).toBeNull();
    expect(publicLeaseHolder("nope", 10)).toBeNull();
  });

  it("validates and extracts playback client IDs", () => {
    expect(readPlaybackClientId({ headers: { "x-playback-client-id": "12345678-1234-1234-1234-123456789abc" } })).toBe("12345678-1234-1234-1234-123456789abc");
    expect(readPlaybackClientId({ headers: {} }, "default-viewer")).toBe("default-viewer");
    expect(readPlaybackClientId({ headers: { "x-playback-client-id": "" } }, "default-viewer")).toBe("default-viewer");
    expect(() => readPlaybackClientId({ headers: { "x-playback-client-id": "short" } })).toThrowError(expect.objectContaining({ statusCode: 400 }));
    expect(() => readPlaybackClientId({ headers: { "x-playback-client-id": "bad!chars@here###" } })).toThrowError(expect.objectContaining({ statusCode: 400 }));
  });

  it("isolates lease ownership between different client IDs sharing viewer and IP", async () => {
    const redis = memoryRedis();
    const tabA = await acquireExclusiveLease(redis, {
      viewerId: "viewer_shared_cookie",
      clientId: "tab_a_1111111111111111",
      sessionId: "session_aaaaaaaaaaaaaaaaaaa",
      mediaId: 1,
      clientIp: "192.168.1.2",
      platform: "web",
      deviceLabel: "Tab A",
    });
    expect(tabA.acquired).toBe(true);

    // Tab B attempts play while Tab A owns lease
    const tabB = await acquireExclusiveLease(redis, {
      viewerId: "viewer_shared_cookie",
      clientId: "tab_b_2222222222222222",
      sessionId: "session_bbbbbbbbbbbbbbbbbbb",
      mediaId: 2,
      clientIp: "192.168.1.2",
      platform: "web",
      deviceLabel: "Tab B",
    });
    expect(tabB.acquired).toBe(false);
    expect(tabB.holder).toMatchObject({
      platform: "web",
      deviceLabel: "Tab A",
      mediaId: 1,
    });

    // Tab A changes track/quality: rotates successfully
    const tabARotate = await acquireExclusiveLease(redis, {
      viewerId: "viewer_shared_cookie",
      clientId: "tab_a_1111111111111111",
      sessionId: "session_a22222222222222222",
      mediaId: 3,
      clientIp: "192.168.1.2",
      platform: "web",
      deviceLabel: "Tab A",
    });
    expect(tabARotate.acquired).toBe(true);
    expect(tabARotate.previousSessionId).toBe("session_aaaaaaaaaaaaaaaaaaa");
  });
});
