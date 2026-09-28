import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchLyrics, getCachedLyrics, isLyricsLoaded, fetchMediaItem, getCachedMediaItem, clearLyricsCache } from "./lyrics-cache";

vi.mock("../../api", () => ({
  api: vi.fn(),
}));

import { api } from "../../api";

describe("lyrics-cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLyricsCache();
  });

  it("fetches, caches and deduplicates in-flight lyrics requests", async () => {
    const mockLyrics = { segments: [{ start: 0, end: 5, text: "Hello" }] };
    api.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockLyrics,
    });

    const promise1 = fetchLyrics(42);
    const promise2 = fetchLyrics(42);

    expect(promise1).toBe(promise2);
    expect(api).toHaveBeenCalledTimes(1);

    const result = await promise1;
    expect(result).toEqual(mockLyrics);
    expect(getCachedLyrics(42)).toEqual(mockLyrics);

    // Subsequent calls return cached data
    const promise3 = fetchLyrics(42);
    const result3 = await promise3;
    expect(result3).toEqual(mockLyrics);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("handles 404 cleanly by caching null", async () => {
    api.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const result = await fetchLyrics(99);
    expect(result).toBeNull();
    expect(getCachedLyrics(99)).toBeNull();

    // Calling again returns cached null without new fetch
    await fetchLyrics(99);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("fetches, caches and deduplicates media items", async () => {
    const mockMedia = { id: 10, title: "Song 10" };
    api.mockResolvedValueOnce({
      ok: true,
      json: async () => mockMedia,
    });

    const p1 = fetchMediaItem(10);
    const p2 = fetchMediaItem(10);
    expect(p1).toBe(p2);
    expect(api).toHaveBeenCalledTimes(1);

    const result = await p1;
    expect(result).toEqual(mockMedia);
    expect(getCachedMediaItem(10)).toEqual(mockMedia);
  });

  it("handles invalid or non-numeric IDs gracefully", async () => {
    expect(await fetchLyrics(null)).toBeNull();
    expect(await fetchLyrics(undefined)).toBeNull();
    expect(await fetchLyrics("not-a-number")).toBeNull();
    expect(getCachedLyrics(null)).toBeNull();
  });

  it("tracks isLyricsLoaded state accurately for in-flight, hit, and 404 miss", async () => {
    expect(isLyricsLoaded(77)).toBe(false);

    api.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ segments: [] }),
    });

    const p = fetchLyrics(77);
    expect(isLyricsLoaded(77)).toBe(false); // in-flight

    await p;
    expect(isLyricsLoaded(77)).toBe(true); // resolved hit

    api.mockResolvedValueOnce({ ok: false, status: 404 });
    await fetchLyrics(88);
    expect(isLyricsLoaded(88)).toBe(true); // resolved miss
    expect(getCachedLyrics(88)).toBeNull();
  });
});
