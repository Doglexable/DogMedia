import { describe, expect, it } from "vitest";
import { findActiveLyricsIndex } from "./lyrics.js";

describe("findActiveLyricsIndex", () => {
  it("finds a segment at its boundaries", () => {
    const segments = [
      { start: 0, end: 2, text: "First" },
      { start: 2.1, end: 4, text: "Second" },
    ];

    expect(findActiveLyricsIndex(segments, 0)).toBe(0);
    expect(findActiveLyricsIndex(segments, 2)).toBe(0);
    expect(findActiveLyricsIndex(segments, 2.1)).toBe(1);
  });

  it("returns no active line during gaps", () => {
    expect(findActiveLyricsIndex([{ start: 5, end: 8, text: "Later" }], 3)).toBe(-1);
  });
});
