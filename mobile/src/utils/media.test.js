import { describe, expect, it } from "vitest";
import { getPlaybackProgress } from "./media.js";

describe("getPlaybackProgress", () => {
  it("returns playback progress as a bounded fraction", () => {
    expect(getPlaybackProgress(25, 100)).toBe(0.25);
    expect(getPlaybackProgress(-10, 100)).toBe(0);
    expect(getPlaybackProgress(120, 100)).toBe(1);
  });

  it("returns zero when playback duration is unavailable", () => {
    expect(getPlaybackProgress(10, 0)).toBe(0);
    expect(getPlaybackProgress(10, undefined)).toBe(0);
    expect(getPlaybackProgress("invalid", 100)).toBe(0);
  });
});
