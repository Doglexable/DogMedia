import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLyricsSelection,
  getLyricsCandidateWindow,
  getLyricsShareMetadata,
  getLyricsShareIndex,
  getSelectedLyrics,
  sanitizeLyricsFilename,
  shareLyricsBlob,
  updateLyricsSelection,
} from "./lyrics-share";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("lyrics share selection", () => {
  it("starts, grows, and shrinks a contiguous selection", () => {
    let selection = createLyricsSelection(2, 8);
    selection = updateLyricsSelection(selection, 3, 8);
    selection = updateLyricsSelection(selection, 1, 8);
    expect(selection).toEqual({ start: 1, end: 3 });
    expect(updateLyricsSelection(selection, 1, 8)).toEqual({ start: 2, end: 3 });
  });

  it("resets for non-adjacent lines and enforces five lines", () => {
    const full = { start: 1, end: 5 };
    expect(updateLyricsSelection(full, 6, 10)).toEqual(full);
    expect(updateLyricsSelection({ start: 2, end: 3 }, 7, 10)).toEqual({ start: 7, end: 7 });
  });

  it("allows the sole selected line to be cleared", () => {
    expect(updateLyricsSelection({ start: 2, end: 2 }, 2, 5)).toBeNull();
  });

  it("returns only selected segments", () => {
    expect(getSelectedLyrics(["a", "b", "c"], { start: 1, end: 2 })).toEqual(["b", "c"]);
  });

  it("uses the latest started lyric when playback is between lines", () => {
    const timed = [{ start: 5 }, { start: 20 }, { start: 30 }];
    expect(getLyricsShareIndex(timed, 25, -1)).toBe(1);
    expect(getLyricsShareIndex(timed, 25, 2)).toBe(2);
  });

  it("builds five-line candidate windows at the start, middle, and end", () => {
    expect(getLyricsCandidateWindow(0, 10)).toEqual({ start: 0, end: 4 });
    expect(getLyricsCandidateWindow(5, 10)).toEqual({ start: 3, end: 7 });
    expect(getLyricsCandidateWindow(9, 10)).toEqual({ start: 5, end: 9 });
    expect(getLyricsCandidateWindow(1, 3)).toEqual({ start: 0, end: 2 });
  });
});

describe("lyrics share metadata", () => {
  it("normalizes metadata and filenames", () => {
    expect(getLyricsShareMetadata({ title: " Song ", artists: " Artist " }, "/cover")).toEqual({
      title: "Song", artists: "Artist", artworkUrl: "/cover",
    });
    expect(sanitizeLyricsFilename("Beyoncé / Halo?!")).toBe("beyonce-halo-lyrics.png");
  });

  it("provides safe fallbacks", () => {
    expect(getLyricsShareMetadata({})).toMatchObject({ title: "Untitled track", artists: "Unknown artist", artworkUrl: null });
    expect(sanitizeLyricsFilename("")).toBe("lyrics-lyrics.png");
  });
});

describe("lyrics share delivery", () => {
  it("uses native file sharing when supported", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { canShare: () => true, share });
    await expect(shareLyricsBlob(new Blob(["png"]), { filename: "song.png", title: "Song" })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: "Song lyrics", files: [expect.any(File)] }));
  });

  it("downloads when native file sharing is unavailable", async () => {
    const click = vi.fn();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", { createElement: () => ({ click }) });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:lyrics", revokeObjectURL: vi.fn() });
    await expect(shareLyricsBlob(new Blob(["png"]), { filename: "song.png", title: "Song" })).resolves.toBe("downloaded");
    expect(click).toHaveBeenCalledOnce();
  });
});
