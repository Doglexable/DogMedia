import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePlaybackClientId, getPlaybackClientId } from "./playback-client-id";

afterEach(() => vi.unstubAllGlobals());

describe("playback-client-id", () => {
  it("returns a stable non-empty string for the document", () => {
    const id1 = getPlaybackClientId();
    const id2 = getPlaybackClientId();
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThanOrEqual(16);
    expect(id1).toBe(id2);
  });

  it("generates distinct IDs on separate invocations", () => {
    const a = generatePlaybackClientId();
    const b = generatePlaybackClientId();
    expect(a).not.toBe(b);
  });

  it("keeps one tab identity across a document reload", async () => {
    const values = new Map();
    vi.stubGlobal("window", { sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    } });
    vi.resetModules();
    const first = (await import("./playback-client-id")).getPlaybackClientId();
    vi.resetModules();
    const second = (await import("./playback-client-id")).getPlaybackClientId();
    expect(second).toBe(first);
  });

  it("generates valid UUID formatted string even without crypto.randomUUID", () => {
    const original = crypto.randomUUID;
    try {
      delete crypto.randomUUID;
      const fallbackId = generatePlaybackClientId();
      expect(typeof fallbackId).toBe("string");
      expect(fallbackId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    } finally {
      crypto.randomUUID = original;
    }
  });
});
