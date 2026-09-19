import { describe, expect, it } from "vitest";
import { reelSegmentArgs } from "./music-reel-worker.js";

describe("music reel renderer", () => {
  it("builds a 10-second 4:3 segment with artwork and faded audio", () => {
    const args = reelSegmentArgs({ audioPath: "/data/song.flac", artworkPath: "/data/cover.webp", outputPath: "/tmp/clip.mp4" });
    expect(args).toContain("10");
    expect(args.join(" ")).toContain("scale=960:720");
    expect(args.join(" ")).toContain("crop=960:720");
    expect(args.join(" ")).toContain("afade=t=out:st=9.5");
    expect(args.join(" ")).toContain("overlay=30:26");
    expect(args.join(" ")).not.toContain("drawtext");
    expect(args.join(" ")).not.toContain("Dogmedia");
    expect(args).toContain("libx264");
  });

  it("uses a generated 4:3 background when artwork is unavailable", () => {
    const args = reelSegmentArgs({ audioPath: "/data/song.mp3", artworkPath: null, outputPath: "/tmp/clip.mp4" });
    expect(args.join(" ")).toContain("color=c=0x17151f:s=960x720:r=30");
  });
});
