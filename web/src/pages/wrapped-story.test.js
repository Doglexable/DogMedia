import { describe, expect, it } from "vitest";
import {
  buildWaveformPoints,
  buildWrappedSlides,
  collectWrappedSlideExports,
  getWrappedSlideFilename,
  getWrappedMediaTitle,
  getWrappedThumbnailUrl,
  isWrappedEmpty,
  WRAPPED_STORY_EXPORT,
} from "./wrapped-story";

describe("buildWrappedSlides", () => {
  it("always produces the six story chapters", () => {
    const slides = buildWrappedSlides({ totalPlayTime: 42, topMedia: [{ mediaId: 7, title: "Track" }] }, []);
    expect(slides.map((slide) => slide.id)).toEqual(["opening", "time", "top-media", "rhythm", "persona", "share"]);
  });

  it("preserves long media titles for responsive rendering", () => {
    const title = "A deliberately very long title that must wrap instead of being silently discarded";
    expect(buildWrappedSlides({ topMedia: [{ mediaId: 7, title }] }, [])[0].title).toBe(title);
  });
});

describe("waveform and media fallbacks", () => {
  it("maps activity into stable SVG points", () => {
    expect(buildWaveformPoints([{ playTime: 0 }, { playTime: 10 }, { playTime: 5 }], 100, 40)).toBe("0,40 50,0 100,20");
  });

  it("provides safe artwork and title fallbacks", () => {
    expect(getWrappedThumbnailUrl({ mediaId: 12 })).toBe("/api/media/12/thumbnail");
    expect(getWrappedThumbnailUrl({ mediaId: null })).toBeNull();
    expect(getWrappedMediaTitle({ mediaId: 12, title: "" })).toBe("Media #12");
  });
});

describe("empty and export states", () => {
  it("recognizes empty reports", () => {
    expect(isWrappedEmpty({ totalPlayTime: 0, totalPlays: 0, topMedia: [] })).toBe(true);
    expect(isWrappedEmpty({ totalPlayTime: 1, totalPlays: 0, topMedia: [] })).toBe(false);
  });

  it("returns fixed vertical export dimensions", () => {
    expect(WRAPPED_STORY_EXPORT).toEqual({
      cssWidth: 432,
      cssHeight: 768,
      width: 1080,
      height: 1920,
      pixelRatio: 2.5,
    });
  });

  it("builds numbered filenames for all six slides", () => {
    const slides = buildWrappedSlides({}, []);
    expect(slides.map(getWrappedSlideFilename)).toEqual([
      "dogmedia-recap-01-opening.png",
      "dogmedia-recap-02-time.png",
      "dogmedia-recap-03-top-media.png",
      "dogmedia-recap-04-rhythm.png",
      "dogmedia-recap-05-persona.png",
      "dogmedia-recap-06-share.png",
    ]);
  });

  it("collects every rendered slide before returning downloads", async () => {
    const slides = buildWrappedSlides({}, []);
    const progress = [];
    const exports = await collectWrappedSlideExports(
      slides,
      async (slide) => ({ slideId: slide.id }),
      (current, total) => progress.push(`${current}/${total}`)
    );

    expect(exports.map((item) => item.blob.slideId)).toEqual(slides.map((slide) => slide.id));
    expect(exports.map((item) => item.filename)).toEqual(slides.map(getWrappedSlideFilename));
    expect(progress).toEqual(["1/6", "2/6", "3/6", "4/6", "5/6", "6/6"]);
  });

  it("rejects bulk capture without returning a partial export set", async () => {
    const slides = buildWrappedSlides({}, []);
    const rendered = [];
    await expect(collectWrappedSlideExports(slides, async (_slide, index) => {
      rendered.push(index);
      if (index === 2) throw new Error("capture failed");
      return { index };
    })).rejects.toThrow("capture failed");
    expect(rendered).toEqual([0, 1, 2]);
  });
});
