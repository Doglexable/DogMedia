import { describe, expect, it } from "vitest";
import { getMediaMeta } from "./player-utils";

describe("getMediaMeta", () => {
  it("handles null and undefined gracefully without throwing", () => {
    expect(getMediaMeta(null)).toEqual({ icon: expect.anything(), label: "File" });
    expect(getMediaMeta(undefined)).toEqual({ icon: expect.anything(), label: "File" });
    expect(getMediaMeta("")).toEqual({ icon: expect.anything(), label: "File" });
  });

  it("correctly identifies media types for valid mime strings", () => {
    expect(getMediaMeta("audio/mp3").label).toBe("Audio");
    expect(getMediaMeta("video/mp4").label).toBe("Video");
    expect(getMediaMeta("image/png").label).toBe("Photo");
    expect(getMediaMeta("application/json").label).toBe("File");
  });
});
