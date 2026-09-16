import { describe, expect, it } from "vitest";
import {
  getArtistLabel,
  getPlaybackProgress,
  parseArtistFromCategory,
  parseArtistFromTitle,
  resolveMediaArtist,
} from "./media.js";

describe("getPlaybackProgress", () => {
  it("returns playback progress as a bounded fraction", () => {
    expect(getPlaybackProgress(25, 100)).toBe(0.25);
    expect(getPlaybackProgress(-10, 100)).toBe(0);
    expect(getPlaybackProgress(120, 100)).toBe(1);
  });

  it("returns zero when playback duration is unavailable", () => {
    expect(getPlaybackProgress(10, 0)).toBe(0);
    expect(getPlaybackProgress(10, undefined)).toBe(0);
    expect(getPlaybackProgress("invalid", 100)).toBe(0);
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

  it("supports a custom fallback label such as folder name", () => {
    expect(getArtistLabel(null, "Absolution")).toBe("Absolution");
    expect(getArtistLabel("", "My Folder")).toBe("My Folder");
    expect(getArtistLabel("Unknown", "Music")).toBe("Music");
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
  it("extracts artist from 3-part hierarchy (Music / Artist / Album)", () => {
    expect(parseArtistFromCategory("Music / Muse / Absolution")).toBe("Muse");
    expect(parseArtistFromCategory("Music / Evanescence / Fallen")).toBe("Evanescence");
    expect(parseArtistFromCategory("Audio / The Cranberries / No Need To Argue")).toBe("The Cranberries");
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
    expect(parseArtistFromCategory(null, "Absolution")).toBe("Absolution");
  });

  it("returns null for generic root categories", () => {
    expect(parseArtistFromCategory("Music")).toBeNull();
    expect(parseArtistFromCategory("Library")).toBeNull();
    expect(parseArtistFromCategory(null, "Music")).toBeNull();
    expect(parseArtistFromCategory(null, "Library")).toBeNull();
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


