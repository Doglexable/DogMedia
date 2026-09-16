import { describe, expect, it } from "vitest";
import { buildBatchItems, buildVideoItems, titleFromStem, trackOrderFromStem, videoOrderFromStem } from "./admin-import-utils";

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
