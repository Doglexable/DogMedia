import { describe, expect, it } from "vitest";
import { findActiveLyricsIndex, getLyricsScrollBehavior } from "./lyrics-panel";

const segments = [
  { start: 2, end: 4, text: "First" },
  { start: 6, end: 8, text: "Second" },
];

describe("findActiveLyricsIndex", () => {
  it("finds a segment at its boundaries", () => {
    expect(findActiveLyricsIndex(segments, 2)).toBe(0);
    expect(findActiveLyricsIndex(segments, 4)).toBe(0);
    expect(findActiveLyricsIndex(segments, 6)).toBe(1);
  });

  it("returns no active line during gaps", () => {
    expect(findActiveLyricsIndex(segments, 0)).toBe(-1);
    expect(findActiveLyricsIndex(segments, 5)).toBe(-1);
    expect(findActiveLyricsIndex(segments, 9)).toBe(-1);
  });

  it("handles empty input and invalid playback positions", () => {
    expect(findActiveLyricsIndex([], 2)).toBe(-1);
    expect(findActiveLyricsIndex(segments, Number.NaN)).toBe(-1);
  });
});

describe("getLyricsScrollBehavior", () => {
  it("disables smooth scrolling when reduced motion is requested", () => {
    expect(getLyricsScrollBehavior(true)).toBe("auto");
    expect(getLyricsScrollBehavior(false)).toBe("smooth");
  });
});
