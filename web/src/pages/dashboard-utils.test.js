import { describe, expect, it } from "vitest";
import {
  addStoredRecentMediaId,
  buildQuickAccessItems,
  getGreeting,
  getStoredRecentMediaIds,
  shouldShowBrowse,
} from "./dashboard-utils";

describe("dashboard browse visibility", () => {
  it("shows Browse even when the media list has fewer than eight items", () => {
    expect(shouldShowBrowse({ mediaCount: 1 })).toBe(true);
    expect(shouldShowBrowse({ mediaCount: 7 })).toBe(true);
    expect(shouldShowBrowse({ mediaCount: 8 })).toBe(true);
  });

  it("shows Browse when the current folder has more than eight media items", () => {
    expect(shouldShowBrowse({ mediaCount: 9 })).toBe(true);
  });

  it("keeps Browse available for search results regardless of count", () => {
    expect(shouldShowBrowse({ hasSearch: true, mediaCount: 0 })).toBe(true);
    expect(shouldShowBrowse({ hasSearch: true, mediaCount: 1 })).toBe(true);
  });

  it("hides Browse only when there are no media items and no search", () => {
    expect(shouldShowBrowse({ mediaCount: 0 })).toBe(false);
  });
});

describe("dashboard greeting", () => {
  it("returns appropriate greeting depending on the time of day", () => {
    expect(getGreeting(new Date("2026-10-23T08:00:00"))).toBe("Good morning");
    expect(getGreeting(new Date("2026-10-23T14:00:00"))).toBe("Good afternoon");
    expect(getGreeting(new Date("2026-10-23T20:00:00"))).toBe("Good evening");
  });
});

describe("dashboard quick access items", () => {
  it("returns an empty array when there are no recently played media items", () => {
    expect(buildQuickAccessItems({ recentIds: [], mediaById: new Map() })).toEqual([]);
  });

  it("returns only real recently played media without fabricating fake tiles or fillers", () => {
    const mockItems = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      title: `Song ${i + 1}`,
    }));
    const mediaById = new Map(mockItems.map((item) => [item.id, item]));

    const result = buildQuickAccessItems({
      recentIds: [5, 3, 1],
      mediaById,
      limit: 8,
    });

    // Exactly the 3 real played items, in order, without any fabricated Liked Songs card
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.id)).toEqual([5, 3, 1]);
    expect(result.every((m) => m.title.startsWith("Song "))).toBe(true);
  });

  it("caps recently played media at limit and excludes unknown or duplicate IDs", () => {
    const mockItems = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      title: `Song ${i + 1}`,
    }));
    const mediaById = new Map(mockItems.map((item) => [item.id, item]));

    const result = buildQuickAccessItems({
      recentIds: [1, 2, 2, 999, 3, 4, 5, 6, 7, 8, 9, 10],
      mediaById,
      limit: 8,
    });

    expect(result).toHaveLength(8);
    expect(result.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("recent media storage helpers", () => {
  it("stores and retrieves recently played media IDs in MRU order", () => {
    const map = new Map();
    const mockStorage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    };

    expect(getStoredRecentMediaIds(mockStorage)).toEqual([]);

    addStoredRecentMediaId(10, mockStorage);
    addStoredRecentMediaId(20, mockStorage);
    addStoredRecentMediaId(10, mockStorage); // Re-playing 10 moves it to front

    expect(getStoredRecentMediaIds(mockStorage)).toEqual([10, 20]);
  });
});
