import { afterEach, describe, expect, it, vi } from "vitest";
import { API_REACHABILITY_TIMEOUT_MS, assertApiReachable, createPlaybackSessionSource } from "./api.js";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
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
});
