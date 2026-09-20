import { describe, expect, it } from "vitest";
import {
  containsNonLatin,
  formatText,
  getDefaultFontPath,
  getUnicodeFallbackFontPath,
  reelSegmentArgs,
} from "./music-reel-worker.js";

describe("music reel renderer", () => {
  it("builds a redesigned 10-second 4:3 segment with artwork, title, artist, and application font", () => {
    const args = reelSegmentArgs({
      audioPath: "/data/song.flac",
      artworkPath: "/data/cover.webp",
      outputPath: "/tmp/clip.mp4",
      title: "Call Me When You're Sober",
      artist: "Evanescence",
    });
    const cmd = args.join(" ");

    expect(args).toContain("10");
    expect(cmd).toContain("scale=960:720");
    expect(cmd).toContain("crop=960:720");
    expect(cmd).toContain("boxblur=28:14");
    expect(cmd).toContain("scrim");
    expect(cmd).toContain("scale=390:390");
    expect(cmd).toContain("drawbox=x=0:y=0:w=iw:h=ih");
    expect(cmd).toContain("afade=t=out:st=9.5");
    expect(cmd).toContain("drawtext=");
    expect(cmd).toContain("Dogmedia");
    expect(cmd).toContain("fontsize=20");
    expect(cmd).toContain("Call Me When You\\'re Sober");
    expect(cmd).toContain("Evanescence");
    expect(cmd).toContain("inter-900.woff2");
    expect(cmd).toContain("inter-700.woff2");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
  });

  it("uses a generated 4:3 placeholder card when artwork is unavailable", () => {
    const args = reelSegmentArgs({
      audioPath: "/data/song.mp3",
      artworkPath: null,
      outputPath: "/tmp/clip.mp4",
      title: "No Artwork Track",
      artist: "Unknown Artist",
    });
    const cmd = args.join(" ");

    expect(cmd).toContain("color=c=0x121318:s=960x720:r=30");
    expect(cmd).toContain("color=c=0x1e2029:s=390x390");
    expect(cmd).toContain("No Artwork Track");
    expect(cmd).toContain("Unknown Artist");
  });

  it("supports textfile inputs for title, artist, and badge", () => {
    const args = reelSegmentArgs({
      audioPath: "/data/song.mp3",
      artworkPath: "/data/cover.jpg",
      titleFile: "/tmp/job/title-0.txt",
      artistFile: "/tmp/job/artist-0.txt",
      badgeFile: "/tmp/job/badge-0.txt",
      outputPath: "/tmp/clip.mp4",
    });
    const cmd = args.join(" ");

    expect(cmd).toContain("textfile='/tmp/job/title-0.txt'");
    expect(cmd).toContain("textfile='/tmp/job/artist-0.txt'");
    expect(cmd).toContain("textfile='/tmp/job/badge-0.txt'");
  });

  it("formats and truncates long titles and artist names with ellipsis", () => {
    expect(formatText("Short Title", 40)).toBe("Short Title");
    expect(formatText("   Multiple   Spaces   In   Name   ", 40)).toBe("Multiple Spaces In Name");
    expect(formatText("This is an extraordinarily long track title that will definitely exceed limit", 30))
      .toBe("This is an extraordinarily lo…");
  });

  it("resolves the application font paths", () => {
    const font = getDefaultFontPath();
    expect(font).toBeTruthy();
    expect(font).toMatch(/inter.*\.woff2$/);
  });

  it("detects non-Latin and CJK text correctly", () => {
    expect(containsNonLatin("DRIVING MY LOVE")).toBe(false);
    expect(containsNonLatin("Evanescence - Bring Me To Life")).toBe(false);
    expect(containsNonLatin("Beyoncé")).toBe(false);
    expect(containsNonLatin("杏里")).toBe(true);
    expect(containsNonLatin("真夜中のドア〜Stay With Me")).toBe(true);
    expect(containsNonLatin("아이유 (IU)")).toBe(true);
    expect(containsNonLatin("周杰倫")).toBe(true);
  });

  it("resolves Unicode / CJK fallback font if available on system", () => {
    const cjkFont = getUnicodeFallbackFontPath({ bold: false });
    const cjkBold = getUnicodeFallbackFontPath({ bold: true });
    // On Linux systems with noto-cjk, this should resolve to a valid font file
    if (cjkFont) {
      expect(cjkFont).toMatch(/\.(ttc|otf|ttf)$/i);
    }
    if (cjkBold) {
      expect(cjkBold).toMatch(/\.(ttc|otf|ttf)$/i);
    }
  });

  it("uses CJK font for non-Latin artist metadata like 杏里", () => {
    const args = reelSegmentArgs({
      audioPath: "/data/song.flac",
      artworkPath: "/data/cover.webp",
      outputPath: "/tmp/clip.mp4",
      title: "DRIVING MY LOVE",
      artist: "杏里",
    });
    const cmd = args.join(" ");

    expect(cmd).toContain("DRIVING MY LOVE");
    expect(cmd).toContain("杏里");
    expect(cmd).toMatch(/NotoSansCJK|Noto Sans CJK/);
  });

  it("applies full-player matching typography with Inter 900 title and Inter 700 artist", () => {
    const args = reelSegmentArgs({
      audioPath: "/data/song.flac",
      artworkPath: "/data/cover.webp",
      outputPath: "/tmp/clip.mp4",
      title: "Bring Me To Life",
      artist: "Evanescence",
    });
    const cmd = args.join(" ");

    expect(cmd).toContain("fontsize=42");
    expect(cmd).toContain("inter-900.woff2");
    expect(cmd).toContain("fontsize=21");
    expect(cmd).toContain("inter-700.woff2");
    expect(cmd).toContain("fontcolor=white@0.68");
  });
});
