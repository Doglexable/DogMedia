import { describe, expect, it } from "vitest";
import {
  buildWaveformPoints,
  buildWrappedPaletteTheme,
  buildWrappedSlides,
  buildWrappedTimeline,
  collectWrappedSlideExports,
  getWrappedCopy,
  getWrappedPeriodDays,
  getWrappedSlideFilename,
  getWrappedSlidePaletteStyle,
  getWrappedMediaTitle,
  getWrappedThumbnailUrl,
  isWrappedEmpty,
  WRAPPED_STORY_EXPORT,
} from "./wrapped-story";

describe("Wrapped artwork theme", () => {
  it("cycles the five exact colors across the five middle cards and mixes the final card", () => {
    const colors = ["#b6ae5d", "#080807", "#efefef", "#a7a8a9", "#5f5f5b"];
    const entries = colors.map((value) => ({ hex: value }));
    expect(getWrappedSlidePaletteStyle("opening", entries)).toEqual({});
    expect(["time", "top-media", "rhythm", "devices", "persona"]
      .map((id) => getWrappedSlidePaletteStyle(id, entries)["--recap-slide-bg"])).toEqual(colors);
    expect(getWrappedSlidePaletteStyle("time", entries)["--recap-slide-fg"]).toBe("#000000");
    expect(getWrappedSlidePaletteStyle("top-media", entries)["--recap-slide-fg"]).toBe("#ffffff");
    const mix = getWrappedSlidePaletteStyle("share", entries)["--recap-mix"];
    expect(colors.every((color) => mix.includes(color))).toBe(true);
  });

  it("assigns all five artwork colors to distinct story roles", () => {
    const colors = ["#f4b189", "#080807", "#92c9d5", "#f5ede2", "#d7a2cf"];
    const theme = buildWrappedPaletteTheme(colors.map((value) => ({ hex: value })));
    expect(new Set([
      theme["--recap-ink"], theme["--recap-white"], theme["--recap-coral"],
      theme["--recap-cyan"], theme["--recap-yellow"],
    ])).toEqual(new Set(colors));
  });

  it("uses artwork colors and keeps every slide background readable", () => {
    const theme = buildWrappedPaletteTheme([
      { hex: "#a94636" }, { hex: "#351215" }, { hex: "#d89054" },
      { hex: "#eee2d8" }, { hex: "#651d27" },
    ]);
    const channels = (color) => [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
    const luminance = (color) => channels(color).reduce((sum, channel, index) => {
      const value = channel / 255;
      return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        * [0.2126, 0.7152, 0.0722][index];
    }, 0);
    const contrast = (a, b) => {
      const values = [luminance(a), luminance(b)].sort((first, second) => first - second);
      return (values[1] + 0.05) / (values[0] + 0.05);
    };

    expect(theme["--recap-ink"]).toBe("#351215");
    expect(theme["--recap-white"]).toBe("#eee2d8");
    for (const role of ["white", "coral", "cyan", "yellow", "accent"]) {
      expect(contrast(theme[`--recap-${role}`], theme["--recap-ink"])).toBeGreaterThanOrEqual(7);
    }
    expect(theme["--recap-coral"]).not.toBe(theme["--recap-cyan"]);
  });

  it("ignores unusable palette entries and falls back when no colors remain", () => {
    expect(buildWrappedPaletteTheme([{ hex: "red" }, { hex: "#fff" }])).toBeNull();
    expect(buildWrappedPaletteTheme([{ hex: "#080807" }])["--recap-coral"]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("buildWrappedSlides", () => {
  it("always produces the seven story chapters", () => {
    const slides = buildWrappedSlides({ totalPlayTime: 42, topMedia: [{ mediaId: 7, title: "Track" }] }, []);
    expect(slides.map((slide) => slide.id)).toEqual(["opening", "time", "top-media", "rhythm", "devices", "persona", "share"]);
    expect(slides[4]).toMatchObject({ id: "devices", items: [], totalCount: 0 });
  });

  it("caps the device story at five contributions while preserving the total count", () => {
    const deviceContributions = Array.from({ length: 7 }, (_, index) => ({ userId: index + 1 }));
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

