import { describe, expect, it } from "vitest";
import { findActiveLyricsIndex, getCenteredLyricsOffset, normalizeLyricsResponse } from "./lyrics.js";

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

  it("handles empty segments and invalid positions", () => {
    expect(findActiveLyricsIndex([], 3)).toBe(-1);
    expect(findActiveLyricsIndex(null, 3)).toBe(-1);
    expect(findActiveLyricsIndex([{ start: 0, end: 2, text: "Line" }], Number.NaN)).toBe(-1);
  });
});

describe("normalizeLyricsResponse", () => {
  it("normalizes a persisted line-synced response", () => {
    expect(normalizeLyricsResponse({
      mediaId: "3",
      language: " en ",
      segments: [{ start: "8.23", end: 12.45, text: " A long line of lyrics that may wrap on a phone " }],
      updatedAt: "2026-08-05T08:27:53.162Z",
    }, 3)).toEqual({
      mediaId: 3,
      language: "en",
      segments: [{ start: 8.23, end: 12.45, text: "A long line of lyrics that may wrap on a phone" }],
      updatedAt: "2026-08-05T08:27:53.162Z",
    });
  });

  it("accepts an empty synchronized result", () => {
    expect(normalizeLyricsResponse({ mediaId: 3, segments: [] }, 3).segments).toEqual([]);
  });

  it.each([
    null,
    {},
    { mediaId: 4, segments: [] },
    { mediaId: 3, segments: null },
    { mediaId: 3, segments: [{ start: -1, end: 2, text: "Invalid" }] },
    { mediaId: 3, segments: [{ start: 3, end: 2, text: "Invalid" }] },
    { mediaId: 3, segments: [{ start: 0, end: 2, text: "" }] },
  ])("rejects malformed or stale responses %#", (payload) => {
    expect(() => normalizeLyricsResponse(payload, 3)).toThrow(TypeError);
  });
});

describe("getCenteredLyricsOffset", () => {
  it("pins lines near the beginning to the top", () => {
    expect(getCenteredLyricsOffset({ contentHeight: 1000, lineHeight: 40, lineY: 20, viewportHeight: 400 })).toBe(0);
  });

  it("centers a wrapped line using its measured height", () => {
    expect(getCenteredLyricsOffset({ contentHeight: 1200, lineHeight: 120, lineY: 500, viewportHeight: 400 })).toBe(360);
  });

  it("pins the final line to the maximum scroll offset", () => {
    expect(getCenteredLyricsOffset({ contentHeight: 1000, lineHeight: 80, lineY: 920, viewportHeight: 400 })).toBe(600);
  });

  it("never returns a negative or non-finite offset", () => {
    expect(getCenteredLyricsOffset({ contentHeight: 0, lineHeight: Number.NaN, lineY: -20, viewportHeight: 400 })).toBe(0);
  });
});
