import { describe, expect, it } from "vitest";
import { generatePlaybackClientId, getPlaybackClientId } from "./playback-client-id";

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
