import { afterEach, describe, expect, it, vi } from "vitest";
import {
  categoryThumbnailUrl,
  createPlaybackSession,
  forceReleasePlaybackLease,
  getPlaybackLease,
  heartbeatPlaybackLease,
  mediaThumbnailUrl,
  readJsonArray,
} from "./api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("readJsonArray", () => {
  it("returns valid collection responses", async () => {
    await expect(readJsonArray(new Response(JSON.stringify([{ id: 1 }]), {
      headers: { "Content-Type": "application/json" }, status: 200,
    }))).resolves.toEqual([{ id: 1 }]);
  });

  it("surfaces an API error instead of returning its object as a collection", async () => {
    await expect(readJsonArray(new Response(JSON.stringify({ error: "Access denied" }), {
      headers: { "Content-Type": "application/json" }, status: 403,
    }), "Could not load media")).rejects.toThrow("Access denied");
  });

  it("rejects successful responses with the wrong shape", async () => {
    await expect(readJsonArray(new Response(JSON.stringify({ items: [] }), {
      headers: { "Content-Type": "application/json" }, status: 200,
    }), "Could not load media")).rejects.toThrow("expected an array response");
  });
});

describe("protected playback", () => {
  it("creates a credentialed session before exposing the stream URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      streamUrl: "/api/media/4/stream?quality=high",
      sessionId: "opaque-session",
      expiresAt: "2026-09-17T00:00:00.000Z",
    }), { headers: { "Content-Type": "application/json" }, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createPlaybackSession(4, "high")).resolves.toMatchObject({
      streamUrl: "/api/media/4/stream?quality=high",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/media/4/playback-session", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ quality: "high" }),
    }));
  });

  it("sends the opaque session in the heartbeat header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, expiresIn: 30 }), {
      headers: { "Content-Type": "application/json" }, status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(heartbeatPlaybackLease("opaque-session")).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/playback/lease/heartbeat", expect.objectContaining({
      method: "POST",
      headers: { "X-Playback-Session": "opaque-session" },
    }));
  });

  it("sends client identity headers and retains the safe holder on conflicts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "PLAYBACK_IN_USE",
      error: "Playback is active on Studio PC",
      retryAfter: 15,
      activeSession: { platform: "desktop", deviceLabel: "Studio PC", mediaId: 9, expiresIn: 15 },
    }), { headers: { "Content-Type": "application/json" }, status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    const failure = createPlaybackSession(4, "high").catch((error) => error);
    await expect(failure).resolves.toMatchObject({
      code: "PLAYBACK_IN_USE",
      activeSession: { platform: "desktop", deviceLabel: "Studio PC", mediaId: 9 },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/media/4/playback-session", expect.objectContaining({
      headers: expect.objectContaining({
        "X-Client-Platform": "web",
        "X-Client-Name": "Dogmedia Web",
      }),
    }));
  });

  it("reads the observable owner snapshot and performs explicit takeover", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: "busy",
        expiresIn: 18,
        activeSession: {
          platform: "desktop",
          deviceLabel: "Studio PC",
          mediaId: 9,
          playback: { mediaId: 9, action: "play", position: 31, duration: 180 },
        },
      }), { headers: { "Content-Type": "application/json" }, status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, released: true }), {
        headers: { "Content-Type": "application/json" }, status: 200,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPlaybackLease()).resolves.toMatchObject({
      state: "busy",
      activeSession: { playback: { mediaId: 9, action: "play", position: 31 } },
    });
    await expect(forceReleasePlaybackLease()).resolves.toEqual({ ok: true, released: true });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/playback/lease/admin", expect.objectContaining({
      method: "DELETE",
      credentials: "include",
    }));
  });
});

describe("categoryThumbnailUrl", () => {
  it("builds thumbnail url with cache-busting cover_path query parameter", () => {
    expect(categoryThumbnailUrl({ id: 7, cover_path: "7/front.webp" })).toBe("/api/categories/7/thumbnail?v=7%2Ffront.webp");
  });

  it("builds thumbnail url without query when cover_path is absent", () => {
    expect(categoryThumbnailUrl({ id: 12 })).toBe("/api/categories/12/thumbnail");
    expect(categoryThumbnailUrl(12)).toBe("/api/categories/12/thumbnail");
  });

  it("returns empty string for invalid category or id", () => {
    expect(categoryThumbnailUrl(null)).toBe("");
    expect(categoryThumbnailUrl({})).toBe("");
    expect(categoryThumbnailUrl(0)).toBe("");
    expect(categoryThumbnailUrl(-1)).toBe("");
  });
});

describe("mediaThumbnailUrl", () => {
  it("builds thumbnail url with artwork_version query parameter", () => {
    expect(mediaThumbnailUrl({ id: 5, artwork_version: "5/front.webp" })).toBe("/api/media/5/thumbnail?v=5%2Ffront.webp");
  });

  it("canonicalizes to category thumbnail url when tracks share category artwork without distinct thumbnail", () => {
    expect(mediaThumbnailUrl({ id: 1, category_id: 7, artwork_version: "7/cover.webp" }))
      .toBe("/api/categories/7/thumbnail?v=7%2Fcover.webp");
    expect(mediaThumbnailUrl({ id: 2, category_id: 7, artwork_version: "7/cover.webp" }))
      .toBe("/api/categories/7/thumbnail?v=7%2Fcover.webp");
  });

  it("builds thumbnail url without query when artwork_version is absent", () => {
    expect(mediaThumbnailUrl({ id: 5 })).toBe("/api/media/5/thumbnail");
    expect(mediaThumbnailUrl(5)).toBe("/api/media/5/thumbnail");
  });

  it("returns empty string for invalid media or id", () => {
    expect(mediaThumbnailUrl(null)).toBe("");
    expect(mediaThumbnailUrl({})).toBe("");
    expect(mediaThumbnailUrl(0)).toBe("");
    expect(mediaThumbnailUrl(-1)).toBe("");
  });
});
