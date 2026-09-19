import { describe, expect, it } from "vitest";
import { buildBatchItems, buildVideoItems, estimateUploadRemaining, formatUploadRemaining, summarizeEncodingStatus, titleFromStem, trackOrderFromStem, videoOrderFromStem } from "./admin-import-utils";

function file(name, { path = name, type = "audio/flac", size = 100 } = {}) {
  return { name, webkitRelativePath: path, type, size };
}

describe("admin album import", () => {
  it("builds readable titles and track numbers from numbered filenames", () => {
    expect(titleFromStem("01 - The Brave")).toBe("The Brave");
    expect(trackOrderFromStem("01 - The Brave")).toBe(1);
    expect(trackOrderFromStem("The Brave")).toBeNull();
  });

  it("matches album artwork and lyrics while preferring lossless audio", () => {
    const items = buildBatchItems([
      file("01 - The Brave.mp3", { path: "Frieren/01 - The Brave.mp3", type: "audio/mpeg", size: 50 }),
      file("01 - The Brave.flac", { path: "Frieren/01 - The Brave.flac" }),
      file("01 - The Brave.json", { path: "Frieren/01 - The Brave.json", type: "application/json" }),
      file("cover.jpg", { path: "Frieren/cover.jpg", type: "image/jpeg" }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "The Brave", trackOrder: 1, skippedCount: 1 });
    expect(items[0].file.name).toBe("01 - The Brave.flac");
    expect(items[0].lyrics.name).toBe("01 - The Brave.json");
    expect(items[0].thumbnail.name).toBe("cover.jpg");
  });
});

describe("admin video import", () => {
  it.each([
    ["Frieren S01E03", 3],
    ["Frieren Episode 12", 12],
    ["Part-04", 4],
    ["05 - Finale", 5],
  ])("detects an episode order from %s", (name, expected) => {
    expect(videoOrderFromStem(name)).toBe(expected);
  });

  it("sorts a multi-video selection naturally and supplies fallback order", () => {
    const items = buildVideoItems([
      file("Episode 10.mkv", { type: "video/x-matroska", size: 100 }),
      file("Special.mkv", { type: "video/x-matroska", size: 100 }),
      file("Episode 2.mkv", { type: "video/x-matroska", size: 100 }),
      file("cover.jpg", { type: "image/jpeg", size: 10 }),
    ]);

    expect(items.map((item) => item.file.name)).toEqual(["Episode 2.mkv", "Special.mkv", "Episode 10.mkv"]);
    expect(items.map((item) => item.trackOrder)).toEqual([2, 3, 10]);
  });
});

describe("upload time remaining", () => {
  it("estimates remaining time from measured upload throughput", () => {
    expect(estimateUploadRemaining({ elapsedMs: 2000, uploadedBytes: 4_000_000, totalBytes: 10_000_000 }))
      .toEqual({ bytesPerSecond: 2_000_000, remainingSeconds: 3 });
  });

  it.each([
    [25, "25s remaining"],
    [0, "Processing upload…"],
    [61, "2m remaining"],
    [3660, "1h 1m remaining"],
    [null, "Estimating time remaining…"],
  ])("formats %j seconds as %s", (seconds, expected) => {
    expect(formatUploadRemaining(seconds)).toBe(expected);
  });
});

describe("encoding progress", () => {
  it("combines lower-resolution jobs into one overall percentage", () => {
    expect(summarizeEncodingStatus({
      low: { status: "ready", progress: 100 },
      med: { status: "processing", progress: 50 },
      high: { status: "queued", progress: 0 },
    })).toMatchObject({ percent: 50, label: "Encoding MED at 50%", pending: 2 });
  });

  it("treats skipped variants as complete and reports failures", () => {
    expect(summarizeEncodingStatus({
      low: { status: "skipped", progress: 0 },
      med: { status: "ready", progress: 100 },
      high: { status: "failed", progress: 20 },
    })).toMatchObject({ percent: 73, label: "1 resolution failed", failed: 1 });
  });
});
