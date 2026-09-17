import { describe, expect, it } from "vitest";
import {
  buildWaveformPoints,
  buildWrappedSlides,
  buildWrappedTimeline,
  collectWrappedSlideExports,
  getWrappedCopy,
  getWrappedPeriodDays,
  getWrappedSlideFilename,
  getWrappedMediaTitle,
  getWrappedThumbnailUrl,
  isWrappedEmpty,
  WRAPPED_STORY_EXPORT,
} from "./wrapped-story";

describe("buildWrappedSlides", () => {
  it("always produces the seven story chapters", () => {
    const slides = buildWrappedSlides({ totalPlayTime: 42, topMedia: [{ mediaId: 7, title: "Track" }] }, []);
    expect(slides.map((slide) => slide.id)).toEqual(["opening", "time", "top-media", "rhythm", "devices", "persona", "share"]);
    expect(slides[4]).toMatchObject({ id: "devices", items: [], totalCount: 0 });
  });

  it("caps the device story at five contributions while preserving the total count", () => {
    const deviceContributions = Array.from({ length: 7 }, (_, index) => ({ ip: `192.168.0.${index + 1}` }));
    const devices = buildWrappedSlides({ deviceContributions }, []).find((slide) => slide.id === "devices");

    expect(devices.items).toHaveLength(5);
    expect(devices.totalCount).toBe(7);
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

describe("period-aware story helpers", () => {
  it("keeps monthly copy as the default", () => {
    expect(getWrappedCopy({ period: { kind: "rolling-30-day" } })).toMatchObject({
      recapLabel: "30-day recap",
      replayTitle: "Your 30-day replay",
    });
  });

  it("renders annual copy and a server-sized timeline for annual reports", () => {
    const data = {
      wrappedKind: "annual",
      periodStart: "2025-12-15T00:00:00.000Z",
      periodEnd: "2026-12-15T23:59:59.999Z",
      period: { kind: "annual-year", days: 366 },
      timeline: [{ date: "2025-12-15", playTime: 90, plays: 1 }],
    };

    expect(getWrappedCopy(data)).toMatchObject({
      recapLabel: "1-year recap",
      replayTitle: "Your 1-year replay",
    });
    expect(getWrappedPeriodDays(data)).toBe(366);
    expect(buildWrappedTimeline(data, data.periodStart)).toHaveLength(366);
    expect(buildWrappedTimeline(data, data.periodStart)[0]).toMatchObject({ date: "2025-12-15", playTime: 90, plays: 1 });
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

  it("builds numbered filenames for all seven slides", () => {
    const slides = buildWrappedSlides({}, []);
    expect(slides.map(getWrappedSlideFilename)).toEqual([
      "dogmedia-recap-01-opening.png",
      "dogmedia-recap-02-time.png",
      "dogmedia-recap-03-top-media.png",
      "dogmedia-recap-04-rhythm.png",
      "dogmedia-recap-05-devices.png",
      "dogmedia-recap-06-persona.png",
      "dogmedia-recap-07-share.png",
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
    expect(progress).toEqual(["1/7", "2/7", "3/7", "4/7", "5/7", "6/7", "7/7"]);
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

