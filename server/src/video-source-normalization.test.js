import { describe, expect, it } from "vitest";
import { matroskaToMp4Args, shouldNormalizeMatroskaSource, validateNormalizedSource } from "./video-source-normalization.js";

describe("MKV source normalization", () => {
  it.each(["film", "video_episode"])("normalizes %s MKV media", (contentKind) => {
    expect(shouldNormalizeMatroskaSource({
      content_kind: contentKind,
      file_path: "7/42.mkv",
      mime_type: "video/x-matroska",
    })).toBe(true);
  });

  it("does not replace music or unrelated video sources", () => {
    expect(shouldNormalizeMatroskaSource({ content_kind: "music", file_path: "7/42.mkv", mime_type: "video/x-matroska" })).toBe(false);
    expect(shouldNormalizeMatroskaSource({ content_kind: "video", file_path: "7/42.mkv", mime_type: "video/x-matroska" })).toBe(false);
    expect(shouldNormalizeMatroskaSource({ content_kind: "film", file_path: "7/42.mp4", mime_type: "video/mp4" })).toBe(false);
  });

  it("produces a browser-compatible H.264 and AAC MP4 command", () => {
    const args = matroskaToMp4Args("source.mkv", "source.mp4");
    expect(args).toEqual(expect.arrayContaining([
      "-map", "0:v:0", "0:a?", "0:s?",
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-ac", "2", "-ar", "48000",
      "-c:s", "mov_text",
      "-movflags", "+faststart",
    ]));
    expect(args.at(-1)).toBe("source.mp4");
  });

  it("rejects replacement when audio or subtitle streams were lost", () => {
    const source = { hasAudio: true, audioStreamCount: 2, subtitleStreamCount: 1 };
    expect(() => validateNormalizedSource(source, { hasVideo: true, hasAudio: true, audioStreamCount: 1, subtitleStreamCount: 1 }))
      .toThrow("every audio stream");
    expect(() => validateNormalizedSource(source, { hasVideo: true, hasAudio: true, audioStreamCount: 2, subtitleStreamCount: 0 }))
      .toThrow("every subtitle stream");
    expect(() => validateNormalizedSource(source, { hasVideo: true, hasAudio: true, audioStreamCount: 2, subtitleStreamCount: 1 }))
      .not.toThrow();
  });
});
