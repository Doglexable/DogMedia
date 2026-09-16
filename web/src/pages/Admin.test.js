import { describe, expect, it } from "vitest";
import { buildBatchItems, titleFromStem, trackOrderFromStem } from "./Admin";

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
