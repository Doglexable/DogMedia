import { describe, expect, it } from "vitest";
import { buildQuickAccessItems, getGreeting, shouldShowBrowse } from "./dashboard-utils";

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
  it("returns an empty array when there are no media items", () => {
    expect(buildQuickAccessItems({ recentIds: [], mediaById: new Map(), fallbackMedia: [] })).toEqual([]);
  });

  it("places Liked Songs at index 1 and limits total items to 8 in a 2x4 grid", () => {
    const mockItems = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      title: `Song ${i + 1}`,
    }));
    const mediaById = new Map(mockItems.map((item) => [item.id, item]));

    const result = buildQuickAccessItems({
      recentIds: [5, 4, 3, 2, 1],
      mediaById,
      fallbackMedia: mockItems,
      limit: 8,
    });

    expect(result).toHaveLength(8);
    expect(result[0].id).toBe(5);
    expect(result[1]).toEqual({
      isLikedTile: true,
      id: "liked-songs",
      title: "Liked Songs",
    });
    expect(result[2].id).toBe(4);
    expect(result[3].id).toBe(3);
    expect(result[4].id).toBe(2);
    expect(result[5].id).toBe(1);
    // 6th and 7th slots filled from fallbackMedia without duplicates
    expect(result[6].id).toBe(6);
    expect(result[7].id).toBe(7);
  });

  it("handles when only a single media item is available", () => {
    const mockItem = { id: 1, title: "Only Song" };
    const mediaById = new Map([[1, mockItem]]);

    const result = buildQuickAccessItems({
      recentIds: [1],
      mediaById,
      fallbackMedia: [mockItem],
      limit: 8,
    });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].isLikedTile).toBe(true);
  });
});
