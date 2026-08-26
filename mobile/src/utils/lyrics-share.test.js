import { describe, expect, it, vi } from "vitest";
import { captureAndShareLyrics, createLyricsSelection, getLyricsCandidateWindow, getLyricsPickerOffset, getLyricsShareIndex, getLyricsShareMetadata, getSelectedLyrics, updateLyricsSelection } from "./lyrics-share.js";

describe("mobile lyrics sharing", () => {
  it("maintains a contiguous selection up to five lines", () => {
    let selection = createLyricsSelection(3, 9);
    selection = updateLyricsSelection(selection, 2, 9);
    selection = updateLyricsSelection(selection, 4, 9);
    expect(selection).toEqual({ start: 2, end: 4 });
    expect(updateLyricsSelection({ start: 0, end: 4 }, 5, 9)).toEqual({ start: 0, end: 4 });
  });

  it("shrinks boundaries, clears a sole line, and resets gaps", () => {
    expect(updateLyricsSelection({ start: 2, end: 4 }, 4, 9)).toEqual({ start: 2, end: 3 });
    expect(updateLyricsSelection({ start: 2, end: 2 }, 2, 9)).toBeNull();
    expect(updateLyricsSelection({ start: 2, end: 3 }, 7, 9)).toEqual({ start: 7, end: 7 });
  });

  it("returns selected lyrics and metadata fallbacks", () => {
    expect(getSelectedLyrics(["a", "b", "c"], { start: 0, end: 1 })).toEqual(["a", "b"]);
    expect(getLyricsShareMetadata({}, null)).toEqual({ title: "Untitled track", artists: "Unknown artist", artworkUri: null });
  });

  it("centers the active lyric in the horizontal share picker", () => {
    expect(getLyricsPickerOffset({ gap: 8, index: 5, itemWidth: 156, viewportWidth: 360 })).toBe(718);
    expect(getLyricsPickerOffset({ gap: 8, index: 0, itemWidth: 156, viewportWidth: 360 })).toBe(0);
  });

  it("chooses the lyric at the playback position, including timing gaps", () => {
    const timed = [{ start: 5 }, { start: 20 }, { start: 30 }];
    expect(getLyricsShareIndex(timed, 25, -1)).toBe(1);
    expect(getLyricsShareIndex(timed, 25, 2)).toBe(2);
  });

  it("builds fixed candidate windows around the active lyric", () => {
    expect(getLyricsCandidateWindow(0, 10)).toEqual({ start: 0, end: 4 });
    expect(getLyricsCandidateWindow(5, 10)).toEqual({ start: 3, end: 7 });
    expect(getLyricsCandidateWindow(9, 10)).toEqual({ start: 5, end: 9 });
    expect(getLyricsCandidateWindow(1, 3)).toEqual({ start: 0, end: 2 });
  });

  it("shares a captured image and always cleans the temporary file", async () => {
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockResolvedValue(undefined);
    await expect(captureAndShareLyrics({
      capture: vi.fn().mockResolvedValue("file://lyrics.png"), deleteFile,
      isAvailable: vi.fn().mockResolvedValue(true), share,
    })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith("file://lyrics.png");
    expect(deleteFile).toHaveBeenCalledWith("file://lyrics.png");
  });

  it("treats share-sheet cancellation as a non-error and still cleans up", async () => {
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    await expect(captureAndShareLyrics({
      capture: vi.fn().mockResolvedValue("file://lyrics.png"), deleteFile,
      isAvailable: vi.fn().mockResolvedValue(true),
      share: vi.fn().mockRejectedValue(Object.assign(new Error("cancelled"), { name: "AbortError" })),
    })).resolves.toBe("cancelled");
    expect(deleteFile).toHaveBeenCalledWith("file://lyrics.png");
  });
});
