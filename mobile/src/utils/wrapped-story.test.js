import { describe, expect, it } from "vitest";
import {
  buildRibbonBars,
  buildWrappedSlides,
  buildWrappedTimeline,
  getWrappedCopy,
  getWrappedPeriodDays,
  getWrappedStoryCardSize,
  getWrappedMediaTitle,
  isWrappedEmpty,
} from "./wrapped-story.js";

describe("mobile wrapped story model", () => {
  it("builds the six story chapters in stable order", () => {
    const slides = buildWrappedSlides({ topMedia: [{ mediaId: 7, title: "Track" }] }, []);
    expect(slides.map((slide) => slide.id)).toEqual([
      "opening",
      "time",
      "top-media",
      "rhythm",
      "persona",
      "final",
    ]);
  });

  it("normalizes a local thirty-day timeline", () => {
    const timeline = buildWrappedTimeline(
      { timeline: [{ date: "2026-08-02", playTime: 90, plays: 2 }] },
      "2026-08-01T12:00:00.000Z",
      3
    );
    expect(timeline).toHaveLength(3);
    expect(timeline.find((day) => day.date === "2026-08-02")).toMatchObject({ playTime: 90, plays: 2 });
  });

  it("maps playback activity into bounded ribbon bars", () => {
    expect(buildRibbonBars([{ playTime: 0 }, { playTime: 5 }, { playTime: 10 }])).toEqual([0.02, 0.5, 1]);
  });

  it("supports annual story copy and timeline sizing", () => {
    const data = {
      wrappedKind: "annual",
      periodStart: "2025-12-15T00:00:00.000Z",
      periodEnd: "2026-12-15T23:59:59.999Z",
      period: { kind: "annual-year", days: 366 },
      timeline: [{ date: "2025-12-15", playTime: 90, plays: 1 }],
    };

    expect(getWrappedCopy(data).recapLabel).toBe("1-year recap");
    expect(getWrappedPeriodDays(data)).toBe(366);
    expect(buildWrappedTimeline(data, data.periodStart)).toHaveLength(366);
    expect(buildWrappedTimeline(data, data.periodStart)[0]).toMatchObject({ date: "2025-12-15", playTime: 90, plays: 1 });
  });

  it("keeps story cards within compact phone and tablet bounds", () => {
    expect(getWrappedStoryCardSize(320, 568)).toEqual({ width: 212.625, height: 378 });
    expect(getWrappedStoryCardSize(375, 667)).toEqual({ width: 268.3125, height: 477 });
    expect(getWrappedStoryCardSize(390, 844)).toEqual({ width: 314, height: 5024 / 9 });
    expect(getWrappedStoryCardSize(1024, 1366)).toEqual({ width: 429.75, height: 764 });
  });

  it("provides title and empty-report fallbacks", () => {
    expect(getWrappedMediaTitle({ mediaId: 12, title: "" })).toBe("Media #12");
    expect(isWrappedEmpty({ totalPlayTime: 0, totalPlays: 0, topMedia: [] })).toBe(true);
    expect(isWrappedEmpty({ totalPlayTime: 1, totalPlays: 0, topMedia: [] })).toBe(false);
  });
});
