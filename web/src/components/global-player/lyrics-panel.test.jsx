import { describe, expect, it } from "vitest";
import {
  buildLyricsDisplaySegments,
  findActiveLyricsIndex,
  getLyricsPreview,
  getLyricsScrollBehavior,
  LyricsShareCard,
} from "./lyrics-panel";

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

describe("buildLyricsDisplaySegments", () => {
  it("adds a presentation-only instrumental cue for gaps of at least three seconds", () => {
    expect(buildLyricsDisplaySegments([
      { start: 1, end: 4, text: "First" },
      { start: 8, end: 10, text: "Second" },
    ])).toEqual([
      { start: 1, end: 4, text: "First", instrumental: false, lyricIndex: 0 },
      { start: 4, end: 7.999, text: "Instrumental", instrumental: true },
      { start: 8, end: 10, text: "Second", instrumental: false, lyricIndex: 1 },
    ]);
  });

  it("does not add cues for short gaps", () => {
    expect(buildLyricsDisplaySegments(segments)).toHaveLength(2);
  });
});

describe("getLyricsScrollBehavior", () => {
  it("disables smooth scrolling when reduced motion is requested", () => {
    expect(getLyricsScrollBehavior(true)).toBe("auto");
    expect(getLyricsScrollBehavior(false)).toBe("smooth");
  });
});

describe("getLyricsPreview", () => {
  it("shows the active line and falls back to the opening line", () => {
    expect(getLyricsPreview(segments, 1)).toBe("Second");
    expect(getLyricsPreview(segments, -1)).toBe("First");
    expect(getLyricsPreview([], 0)).toBe("");
  });
});

describe("LyricsShareCard", () => {
  it("renders the Dogmedia brand logo image and title", async () => {
    const { renderToString } = await import("react-dom/server");
    const markup = renderToString(
      <LyricsShareCard
        metadata={{ title: "Sample Song", artists: "Sample Artist" }}
        selected={[{ start: 0, text: "Line one" }]}
      />
    );
    expect(markup).toContain('src="/web-app-manifest-192x192.png"');
    expect(markup).toContain('class="lyrics-share-card-logo"');
    expect(markup).toContain("Dogmedia");
  });
});
