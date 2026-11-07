import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  categoryThumbnailUrl,
  createPlaybackSession,
  forceReleasePlaybackLease,
  getPlaybackLease,
  heartbeatPlaybackLease,
  mediaThumbnailUrl,
  preparePlaybackStream,
  profilePictureUrl,
  readJsonArray,
  requestPlaybackSocketTicket,
  resumePlaybackSession,
} from "./api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

describe("account session expiry", () => {
  it("opens login only when the account session expires", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "PLAYBACK_SESSION_INVALID" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "LOGIN_REQUIRED" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await api("/api/media/42/stream");
    expect(dispatchEvent).not.toHaveBeenCalled();
    await api("/api/media/42/thumbnail");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });
});

describe("protected playback", () => {
  const session = { streamUrl: "/api/media/9/stream?quality=high", sessionId: "opaque-session" };

  it.each([202, 409])("waits for a playable stream after HTTP %s", async (status) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: status === 202 ? "ENCODING_QUEUED" : "ENCODING_NOT_READY",
        statusUrl: "/api/media/9/encoding/status",
        retryAfter: 0,
      }), { status, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response("x", { status: 206 }));
    vi.stubGlobal("fetch", fetchMock);

    const ready = preparePlaybackStream(session);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(ready).resolves.toBe(session.streamUrl);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, session.streamUrl, expect.objectContaining({
      headers: { Range: "bytes=0-0", "X-Playback-Session": session.sessionId },
    }));
  });

  it("rejects a pending response without a retry URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "ENCODING_QUEUED",
    }), { status: 202, headers: { "Content-Type": "application/json" } })));
    await expect(preparePlaybackStream(session)).rejects.toMatchObject({ code: "ENCODING_QUEUED" });
  });

  it.each([200, 206])("accepts a stream immediately on HTTP %s", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("x", { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(preparePlaybackStream(session)).resolves.toBe(session.streamUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not accept another 2xx response as media", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(preparePlaybackStream(session)).rejects.toThrow("Playback rendition is unavailable");
  });

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
      headers: expect.objectContaining({
        "X-Playback-Client-ID": expect.any(String),
      }),
      body: JSON.stringify({ quality: "high" }),
    }));
  });

  it("resumes an existing session and falls back only when the server no longer has it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        streamUrl: "/api/media/4/stream?quality=high", sessionId: "opaque-session",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(resumePlaybackSession(4, "opaque-session", "high")).resolves.toMatchObject({ sessionId: "opaque-session" });
    expect(fetchMock).toHaveBeenCalledWith("/api/media/4/playback-session/resume", expect.objectContaining({
      method: "POST", credentials: "include",
      headers: expect.objectContaining({
        "X-Playback-Session": "opaque-session",
        "X-Playback-Client-ID": expect.any(String),
      }),
      body: JSON.stringify({ quality: "high" }),
    }));
    await expect(resumePlaybackSession(4, "opaque-session", "high")).resolves.toBeNull();
  });

  it("requests a socket ticket with the playback client id header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ticket: "fake-ticket" }), {
      headers: { "Content-Type": "application/json" }, status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestPlaybackSocketTicket()).resolves.toBe("fake-ticket");
    expect(fetchMock).toHaveBeenCalledWith("/api/playback/socket-ticket", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "X-Playback-Client-ID": expect.any(String),
      }),
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
    expect(fetchMock).toHaveBeenCalledWith("/api/playback/lease", expect.objectContaining({
      headers: expect.objectContaining({
        "X-Playback-Client-ID": expect.any(String),
      }),
    }));
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

  it("supports blur option for low-resolution blurred placeholder", () => {
    expect(categoryThumbnailUrl({ id: 7, cover_path: "7/front.webp" }, { blur: true }))
      .toBe("/api/categories/7/thumbnail?v=7%2Ffront.webp&blur=1");
    expect(categoryThumbnailUrl(7, { blur: true }))
      .toBe("/api/categories/7/thumbnail?blur=1");
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

  it("supports blur option for low-resolution blurred placeholder", () => {
    expect(mediaThumbnailUrl({ id: 5, artwork_version: "5/front.webp" }, { blur: true }))
      .toBe("/api/media/5/thumbnail?v=5%2Ffront.webp&blur=1");
    expect(mediaThumbnailUrl(5, { blur: true }))
      .toBe("/api/media/5/thumbnail?blur=1");
  });

  it("canonicalizes to category thumbnail url when tracks share category artwork without distinct thumbnail", () => {
    expect(mediaThumbnailUrl({ id: 1, category_id: 7, artwork_version: "7/cover.webp" }))
      .toBe("/api/categories/7/thumbnail?v=7%2Fcover.webp");
    expect(mediaThumbnailUrl({ id: 2, category_id: 7, artwork_version: "7/cover.webp" }))
      .toBe("/api/categories/7/thumbnail?v=7%2Fcover.webp");
  });

  it("canonicalizes to category thumbnail url with blur when requested", () => {
    expect(mediaThumbnailUrl({ id: 1, category_id: 7, artwork_version: "7/cover.webp" }, { blur: true }))
      .toBe("/api/categories/7/thumbnail?v=7%2Fcover.webp&blur=1");
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

describe("profilePictureUrl", () => {
  it("builds profile picture URL with size parameter", () => {
    expect(profilePictureUrl("fine", "s")).toBe("/api/profile-pictures/fine?size=s");
    expect(profilePictureUrl("fine", "l")).toBe("/api/profile-pictures/fine?size=l");
    expect(profilePictureUrl("monoco_good", "s")).toBe("/api/profile-pictures/monoco_good?size=s");
    expect(profilePictureUrl("monoco_good", "l")).toBe("/api/profile-pictures/monoco_good?size=l");
  });

  it("normalizes filenames with underscores or webp extension", () => {
    expect(profilePictureUrl("_fine_s_.webp", "l")).toBe("/api/profile-pictures/fine?size=l");
    expect(profilePictureUrl("_monoco_good_l_.webp", "s")).toBe("/api/profile-pictures/monoco_good?size=s");
  });

  it("defaults to fine avatar and s size when not specified", () => {
    expect(profilePictureUrl()).toBe("/api/profile-pictures/fine?size=s");
    expect(profilePictureUrl(null)).toBe("/api/profile-pictures/fine?size=s");
    expect(profilePictureUrl("fine")).toBe("/api/profile-pictures/fine?size=s");
  });
});
