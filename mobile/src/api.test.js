import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_REACHABILITY_TIMEOUT_MS,
  assertApiReachable,
  createPlaybackSessionSource,
  forceReleasePlaybackLease,
  getPlaybackLease,
  preparePlaybackSource,
  protectedMediaSource,
  setAccountToken,
} from "./api.js";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

afterEach(async () => {
  await setAccountToken("");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("API reachability", () => {
  it.each([200, 403, 500])("treats an HTTP %s response as reachable", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status });
    vi.stubGlobal("fetch", fetchMock);

    await expect(assertApiReachable()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/check-access"),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("returns a typed error when the network request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Network request failed")));

    await expect(assertApiReachable()).rejects.toMatchObject({ code: "API_UNREACHABLE" });
  });

  it("aborts an API probe after 2.5 seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    })));

    const probe = assertApiReachable();
    const rejection = expect(probe).rejects.toMatchObject({ code: "API_UNREACHABLE" });
    await vi.advanceTimersByTimeAsync(API_REACHABILITY_TIMEOUT_MS);
    await rejection;
  });
});

describe("protected playback", () => {
  const source = { uri: "http://localhost:3001/api/media/9/stream?quality=high", headers: { "X-Playback-Session": "opaque-session" } };

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

    const ready = preparePlaybackSource(source);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(ready).resolves.toBe(source);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, source.uri, expect.objectContaining({
      headers: { ...source.headers, Range: "bytes=0-0" },
    }));
  });

  it("rejects a pending response without a retry URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "ENCODING_QUEUED",
    }), { status: 202, headers: { "Content-Type": "application/json" } })));
    await expect(preparePlaybackSource(source)).rejects.toMatchObject({ code: "ENCODING_QUEUED" });
  });

  it.each([200, 206])("accepts a stream immediately on HTTP %s", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("x", { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(preparePlaybackSource(source)).resolves.toBe(source);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not accept another 2xx response as media", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(preparePlaybackSource(source)).rejects.toThrow("Playback rendition is unavailable");
  });

  it("attaches the account token to native artwork and stream requests", async () => {
    await setAccountToken("test-account-token");
    expect(protectedMediaSource("http://localhost:3001/api/media/9/thumbnail").headers)
      .toEqual({ Authorization: "Bearer test-account-token" });
    expect(protectedMediaSource("file:///offline/cover.jpg")).toEqual({ uri: "file:///offline/cover.jpg" });
    expect(protectedMediaSource("http://localhost:3001.evil.test/api/media/9/thumbnail"))
      .toEqual({ uri: "http://localhost:3001.evil.test/api/media/9/thumbnail" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      streamUrl: "/api/media/9/stream?quality=med",
      sessionId: "opaque-session",
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
    }), { headers: { "Content-Type": "application/json" }, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const source = await createPlaybackSessionSource(9, "med");
    expect(source.headers.Authorization).toBe("Bearer test-account-token");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-account-token");
  });

  it("returns a native media source with the opaque session header", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      streamUrl: "/api/media/9/stream?quality=med",
      sessionId: "opaque-session",
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
      leaseRequired: true,
    }), { headers: { "Content-Type": "application/json" }, status: 200 })));

    await expect(createPlaybackSessionSource(9, "med")).resolves.toEqual({
      uri: expect.stringContaining("/api/media/9/stream?quality=med"),
      headers: {
        "X-Playback-Session": "opaque-session",
        "X-Viewer-ID": "viewer_aaaaaaaaaaaaaaaaaaaa",
      },
      sessionId: "opaque-session",
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
      leaseRequired: true,
    });
  });

  it("identifies the mobile client when creating a session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      streamUrl: "/api/media/9/stream?quality=med",
      sessionId: "opaque-session",
      viewerId: "viewer_aaaaaaaaaaaaaaaaaaaa",
      leaseRequired: true,
    }), { headers: { "Content-Type": "application/json" }, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createPlaybackSessionSource(9, "med");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/media/9/playback-session"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Client-Platform": "mobile",
          "X-Client-Name": "Dogmedia Mobile",
        }),
      }),
    );
  });

  it("reads the observable owner snapshot and performs explicit takeover", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: "busy",
        expiresIn: 18,
        activeSession: {
          platform: "web",
          deviceLabel: "Dogmedia Web",
          mediaId: 9,
          playback: { mediaId: 9, action: "pause", position: 44, duration: 180 },
        },
      }), { headers: { "Content-Type": "application/json" }, status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, released: true }), {
        headers: { "Content-Type": "application/json" }, status: 200,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPlaybackLease()).resolves.toMatchObject({
      state: "busy",
      activeSession: { playback: { mediaId: 9, action: "pause", position: 44 } },
    });
    await expect(forceReleasePlaybackLease()).resolves.toEqual({ ok: true, released: true });
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/playback/lease/admin"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
