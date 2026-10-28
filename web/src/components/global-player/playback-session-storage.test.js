import { afterEach, describe, expect, it, vi } from "vitest";
import { clearStoredPlaybackSession, readStoredPlaybackSession, storePlaybackSession } from "./playback-session-storage";

afterEach(() => vi.unstubAllGlobals());

describe("playback session storage", () => {
  it("recovers only the matching account, media, and quality and clears the active token", () => {
    const values = new Map();
    vi.stubGlobal("window", { sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    } });
    const sessionId = "session_aaaaaaaaaaaaaaaaaaaa";
    storePlaybackSession(1, 9, "high", sessionId);
    expect(readStoredPlaybackSession(1, 9, "high")).toBe(sessionId);
    expect(readStoredPlaybackSession(2, 9, "high")).toBeNull();
    expect(readStoredPlaybackSession(1, 10, "high")).toBeNull();
    expect(readStoredPlaybackSession(1, 9, "low")).toBeNull();
    clearStoredPlaybackSession("session_bbbbbbbbbbbbbbbbbbbb");
    expect(readStoredPlaybackSession(1, 9, "high")).toBe(sessionId);
    clearStoredPlaybackSession(sessionId);
    expect(readStoredPlaybackSession(1, 9, "high")).toBeNull();
  });
});
