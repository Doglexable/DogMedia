import { describe, expect, it } from "vitest";
import { getCompletionAction, getMediaMeta, getQueueBoundaryParams } from "./player-utils";

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

describe("getQueueBoundaryParams", () => {
  it("returns offset 0 when wrapping to the beginning of the queue (atEnd = false)", () => {
    const params = getQueueBoundaryParams(false, 10);
    expect(params.get("limit")).toBe("1");
    expect(params.get("offset")).toBe("0");
  });

  it("returns offset total - 1 when seeking to the end of the queue (atEnd = true)", () => {
    const params = getQueueBoundaryParams(true, 10);
    expect(params.get("limit")).toBe("1");
    expect(params.get("offset")).toBe("9");
  });

  it("clamps negative or zero total safely", () => {
    expect(getQueueBoundaryParams(false, 0).get("offset")).toBe("0");
    expect(getQueueBoundaryParams(true, 0).get("offset")).toBe("0");
    expect(getQueueBoundaryParams(true, 1).get("offset")).toBe("0");
  });
});

describe("getCompletionAction", () => {
  it("prioritizes repeat when loopMode is media", () => {
    expect(getCompletionAction({ loopMode: "media", hasLinearNext: true, queueLength: 5 })).toBe("repeat");
    expect(getCompletionAction({ loopMode: "media", hasLinearNext: false, queueLength: 0 })).toBe("repeat");
  });

  it("advances when linear next track is available", () => {
    expect(getCompletionAction({ loopMode: "none", hasLinearNext: true, queueLength: 5 })).toBe("advance");
    expect(getCompletionAction({ loopMode: "queue", hasLinearNext: true, queueLength: 5 })).toBe("advance");
  });

  it("wraps when loopMode is queue at the end of a non-empty playlist", () => {
    expect(getCompletionAction({ loopMode: "queue", hasLinearNext: false, queueLength: 5 })).toBe("wrap");
    expect(getCompletionAction({ loopMode: "queue", hasLinearNext: false, queueLength: 1 })).toBe("wrap");
  });

  it("stops when loopMode is none at the end of playlist", () => {
    expect(getCompletionAction({ loopMode: "none", hasLinearNext: false, queueLength: 5 })).toBe("stop");
    expect(getCompletionAction({ loopMode: "none", hasLinearNext: false, queueLength: 0 })).toBe("stop");
  });
});
