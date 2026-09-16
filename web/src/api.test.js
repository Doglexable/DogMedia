import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaybackSession, heartbeatPlaybackLease, readJsonArray } from "./api";

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
});
