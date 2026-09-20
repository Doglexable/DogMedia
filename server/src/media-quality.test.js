import { describe, expect, it } from "vitest";
import {
  ENCODING_PRESETS,
  normalizeRequestedQuality,
  selectActualQuality,
  shouldCreateVariant,
} from "./media-quality.js";
import { encodingProgressPercent, ffmpegArgs, validateEncodedStreams } from "./encoding-worker.js";

describe("media quality selection", () => {
  it("keeps omitted stream requests compatible with original media", () => {
    expect(normalizeRequestedQuality(undefined)).toBe("ori");
    expect(normalizeRequestedQuality("cinema")).toBeNull();
  });

  it.each([
    ["high", ["low", "med"], "med"],
    ["high", ["low"], "low"],
    ["med", ["high"], "ori"],
    ["low", [], "ori"],
    ["ori", ["low", "med", "high"], "ori"],
  ])("resolves %s against %j to %s", (requested, ready, expected) => {
    expect(selectActualQuality(requested, ready)).toBe(expected);
  });
});

describe("encoding decisions", () => {
  it.each([
    [95_999, false],
    [96_000, false],
    [96_001, true],
  ])("creates low audio only above its bitrate ceiling (%i)", (bitrate, expected) => {
    expect(shouldCreateVariant("audio", { bitrate }, ENCODING_PRESETS.audio.low)).toBe(expected);
  });

  it.each([
    [{ height: 479, bitrate: 999_999 }, false],
    [{ height: 480, bitrate: 1_000_000 }, false],
    [{ height: 481, bitrate: 900_000 }, true],
    [{ height: 360, bitrate: 1_000_001 }, true],
  ])("creates low video only when a relevant source measure exceeds the preset", (source, expected) => {
    expect(shouldCreateVariant("video", source, ENCODING_PRESETS.video.low)).toBe(expected);
  });

  it.each([
    [{ width: 639, height: 400 }, false],
    [{ width: 640, height: 640 }, false],
    [{ width: 400, height: 641 }, true],
  ])("does not upscale low image variants", (source, expected) => {
    expect(shouldCreateVariant("image", source, ENCODING_PRESETS.image.low)).toBe(expected);
  });

  it("uses bounded dimensions in video and image ffmpeg filters", () => {
    expect(ffmpegArgs({ inputPath: "in", outputPath: "out", kind: "video", preset: ENCODING_PRESETS.video.med }).join(" ")).toContain("min(720,ih)");
    expect(ffmpegArgs({ inputPath: "in", outputPath: "out", kind: "image", preset: ENCODING_PRESETS.image.med }).join(" ")).toContain("min(1280,iw)");
  });

  it("maps MKV audio into browser-safe stereo video variants", () => {
    const args = ffmpegArgs({ inputPath: "source.mkv", outputPath: "out.mp4", kind: "video", preset: ENCODING_PRESETS.video.med });
    expect(args).toEqual(expect.arrayContaining([
      "-map", "0:v:0", "0:a:0?", "-c:a", "aac", "-ac", "2", "-ar", "48000",
    ]));
  });

  it("rejects a video rendition when source audio was lost", () => {
    expect(() => validateEncodedStreams("video", { hasAudio: true }, { hasVideo: true, hasAudio: false }))
      .toThrow("missing its source audio stream");
    expect(() => validateEncodedStreams("video", { hasAudio: true }, { hasVideo: true, hasAudio: true }))
      .not.toThrow();
  });
});

describe("encoding progress", () => {
  it("converts ffmpeg microsecond timestamps into bounded percentages", () => {
    expect(encodingProgressPercent("out_time_ms=30000000", 120)).toBe(25);
    expect(encodingProgressPercent("out_time_ms=999000000", 120)).toBe(99);
    expect(encodingProgressPercent("progress=end", 120)).toBe(100);
    expect(encodingProgressPercent("frame=20", 120)).toBeNull();
  });
});
