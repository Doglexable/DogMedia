import { describe, expect, it } from "vitest";
import {
  getArtistLabel,
  getAutoQueueEndpoint,
  getCompletionAction,
  getMediaMeta,
  getQueueBoundaryParams,
  isPauseTimeoutExpired,
  parseArtistFromCategory,
  parseArtistFromTitle,
  resolveMediaArtist,
} from "./player-utils";

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

describe("isPauseTimeoutExpired", () => {
  it("returns false if pausedAt is missing or invalid", () => {
    expect(isPauseTimeoutExpired(null)).toBe(false);
    expect(isPauseTimeoutExpired(undefined)).toBe(false);
    expect(isPauseTimeoutExpired("not-a-date")).toBe(false);
  });

  it("returns false if pause duration is under 30 minutes", () => {
    const now = 1_000_000_000;
    const pausedAt = new Date(now - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    expect(isPauseTimeoutExpired(pausedAt, now)).toBe(false);
  });

  it("returns true if pause duration is 30 minutes or more", () => {
    const now = 1_000_000_000;
    const exactly30 = new Date(now - 30 * 60 * 1000).toISOString();
    const over30 = new Date(now - 35 * 60 * 1000).toISOString();
    expect(isPauseTimeoutExpired(exactly30, now)).toBe(true);
    expect(isPauseTimeoutExpired(over30, now)).toBe(true);
  });

  it("supports numeric timestamp for pausedAt", () => {
    const now = 1_000_000_000;
    expect(isPauseTimeoutExpired(now - 31 * 60 * 1000, now)).toBe(true);
    expect(isPauseTimeoutExpired(now - 29 * 60 * 1000, now)).toBe(false);
  });
});

describe("getArtistLabel", () => {
  it("returns trimmed artist string", () => {
    expect(getArtistLabel(" Muse ")).toBe("Muse");
  });

  it("joins array of artists", () => {
    expect(getArtistLabel(["Muse", "Radiohead"])).toBe("Muse, Radiohead");
  });

  it("falls back when artist is null, empty, or generic unknown", () => {
    expect(getArtistLabel(null)).toBe("Unknown artist");
    expect(getArtistLabel(undefined)).toBe("Unknown artist");
    expect(getArtistLabel("")).toBe("Unknown artist");
    expect(getArtistLabel("  ")).toBe("Unknown artist");
    expect(getArtistLabel("Unknown")).toBe("Unknown artist");
    expect(getArtistLabel("unknown artist")).toBe("Unknown artist");
  });

  it("supports custom fallback", () => {
    expect(getArtistLabel(null, "Absolution")).toBe("Absolution");
    expect(getArtistLabel("", "My Folder")).toBe("My Folder");
  });
});

describe("parseArtistFromTitle", () => {
  it("parses artist from hyphenated title format", () => {
    expect(parseArtistFromTitle("Muse - Hysteria")).toBe("Muse");
    expect(parseArtistFromTitle("The Cranberries - Zombie (Remastered)")).toBe("The Cranberries");
  });

  it("handles leading track numbers with hyphen or period", () => {
    expect(parseArtistFromTitle("01. The Cranberries - Zombie")).toBe("The Cranberries");
    expect(parseArtistFromTitle("02 - Evanescence - Bring Me To Life")).toBe("Evanescence");
    expect(parseArtistFromTitle("3. Muse - Time Is Running Out")).toBe("Muse");
  });

  it("supports en-dash, em-dash, and colon delimiters", () => {
    expect(parseArtistFromTitle("Fall Out Boy – Thriller")).toBe("Fall Out Boy");
    expect(parseArtistFromTitle("Radiohead — Karma Police")).toBe("Radiohead");
    expect(parseArtistFromTitle("Adele: Rolling in the Deep")).toBe("Adele");
  });

  it("returns null when title has no artist delimiter or is generic unknown", () => {
    expect(parseArtistFromTitle("Hysteria")).toBeNull();
    expect(parseArtistFromTitle("01. Intro")).toBeNull();
    expect(parseArtistFromTitle("Unknown - Song")).toBeNull();
    expect(parseArtistFromTitle("")).toBeNull();
    expect(parseArtistFromTitle(null)).toBeNull();
  });
});

describe("parseArtistFromCategory", () => {
  it("extracts artist from 3-part hierarchy", () => {
    expect(parseArtistFromCategory("Music / Muse / Absolution")).toBe("Muse");
  });

  it("extracts artist from 2-part hierarchy", () => {
    expect(parseArtistFromCategory("Music / Muse")).toBe("Muse");
    expect(parseArtistFromCategory("Muse / Absolution")).toBe("Muse");
  });

  it("extracts non-generic single category", () => {
    expect(parseArtistFromCategory("Radiohead")).toBe("Radiohead");
  });

  it("falls back to categoryName when non-generic", () => {
    expect(parseArtistFromCategory(null, "Muse")).toBe("Muse");
  });

  it("returns null for generic root categories", () => {
    expect(parseArtistFromCategory("Music")).toBeNull();
    expect(parseArtistFromCategory("Library")).toBeNull();
  });
});

describe("resolveMediaArtist", () => {
  it("returns direct artists array or string", () => {
    expect(resolveMediaArtist({ artists: "Muse", mime_type: "audio/flac" })).toBe("Muse");
    expect(resolveMediaArtist({ artists: ["Muse", "Radiohead"], mime_type: "audio/flac" })).toBe("Muse, Radiohead");
    expect(resolveMediaArtist({ artist: "Radiohead", mime_type: "audio/flac" })).toBe("Radiohead");
  });

  it("resolves from title when artists is missing or unknown", () => {
    expect(resolveMediaArtist({ title: "Muse - Hysteria", mime_type: "audio/flac" })).toBe("Muse");
    expect(resolveMediaArtist({ artists: "Unknown artist", title: "The Cranberries - Zombie", mime_type: "audio/flac" })).toBe("The Cranberries");
    expect(resolveMediaArtist({ artists: null, title: "01. Fall Out Boy - Thriller", mime_type: "audio/flac" })).toBe("Fall Out Boy");
  });

  it("resolves from category path when artists and title delimiter are missing", () => {
    expect(resolveMediaArtist({
      title: "Hysteria",
      category_path: "Music / Muse / Absolution",
      mime_type: "audio/flac",
    })).toBe("Muse");
  });

  it("resolves from category name as folder fallback", () => {
    expect(resolveMediaArtist({
      title: "Hysteria",
      category_name: "Absolution",
      mime_type: "audio/flac",
    })).toBe("Absolution");
  });

  it("does not show Unknown artist for video or photo media", () => {
    expect(resolveMediaArtist({
      title: "DWI-REJEKI-UBE",
      category_name: "Film",
      mime_type: "video/mp4",
    })).toBe("Film");

    expect(resolveMediaArtist({
      title: "Clip",
      mime_type: "video/mp4",
    })).toBe("Video");
  });

  it("falls back to Unknown artist only when no artist info can be inferred for audio", () => {
    expect(resolveMediaArtist({ title: "Untitled", mime_type: "audio/mp3" })).toBe("Unknown artist");
    expect(resolveMediaArtist(null)).toBe("Unknown artist");
    expect(resolveMediaArtist(null, "Custom Fallback")).toBe("Custom Fallback");
  });
});

describe("getAutoQueueEndpoint", () => {
  it("resolves to likes endpoint when context is liked", () => {
    expect(getAutoQueueEndpoint(42, null, "liked")).toBe("/api/queue/auto/likes?start=42&compact=1");
  });

  it("resolves to likes endpoint when categoryId is liked", () => {
    expect(getAutoQueueEndpoint(42, "liked")).toBe("/api/queue/auto/likes?start=42&compact=1");
  });

  it("resolves to category auto-queue endpoint when categoryId is provided", () => {
    expect(getAutoQueueEndpoint(42, 7)).toBe("/api/queue/auto/7?start=42&compact=1");
    expect(getAutoQueueEndpoint(42, "15")).toBe("/api/queue/auto/15?start=42&compact=1");
  });

  it("resolves to global auto-queue endpoint when neither categoryId nor liked context is provided", () => {
    expect(getAutoQueueEndpoint(42)).toBe("/api/queue/auto?start=42&compact=1");
    expect(getAutoQueueEndpoint(42, null, null)).toBe("/api/queue/auto?start=42&compact=1");
  });
});


