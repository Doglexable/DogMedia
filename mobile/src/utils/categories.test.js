import { describe, expect, it } from "vitest";
import {
  filterDisplayCategories,
  findCategoryById,
  getBrowseSectionTitle,
  toggleCategorySelection,
} from "./categories.js";

describe("mobile category utilities", () => {
  describe("filterDisplayCategories", () => {
    it("returns empty array when given non-array or null", () => {
      expect(filterDisplayCategories(null)).toEqual([]);
      expect(filterDisplayCategories(undefined)).toEqual([]);
      expect(filterDisplayCategories("invalid")).toEqual([]);
    });

    it("filters out categories with media_count 0 when media_count is present", () => {
      const categories = [
        { id: 1, name: "Rock", media_count: 5 },
        { id: 2, name: "Empty", media_count: 0 },
        { id: 3, name: "Pop", media_count: 12 },
      ];
      expect(filterDisplayCategories(categories)).toEqual([
        { id: 1, name: "Rock", media_count: 5 },
        { id: 3, name: "Pop", media_count: 12 },
      ]);
    });

    it("keeps all categories if media_count is not provided on any items", () => {
      const categories = [
        { id: 1, name: "Rock" },
        { id: 2, name: "Pop" },
      ];
      expect(filterDisplayCategories(categories)).toEqual(categories);
    });
  });

  describe("findCategoryById", () => {
    const categories = [
      { id: 1, name: "Rock", path: "Music / Rock" },
      { id: 2, name: "Pop", path: "Music / Pop" },
    ];

    it("finds category by numeric ID", () => {
      expect(findCategoryById(categories, 1)).toEqual(categories[0]);
    });

    it("finds category by string ID", () => {
      expect(findCategoryById(categories, "2")).toEqual(categories[1]);
    });

    it("returns null if not found or id is null", () => {
      expect(findCategoryById(categories, 999)).toBeNull();
      expect(findCategoryById(categories, null)).toBeNull();
      expect(findCategoryById(null, 1)).toBeNull();
    });
  });

  describe("toggleCategorySelection", () => {
    it("returns targetId when selectedId is different", () => {
      expect(toggleCategorySelection(null, 1)).toBe(1);
      expect(toggleCategorySelection(2, 1)).toBe(1);
      expect(toggleCategorySelection("2", 1)).toBe(1);
    });

    it("returns null when clicking active category to toggle off", () => {
      expect(toggleCategorySelection(1, 1)).toBeNull();
      expect(toggleCategorySelection("1", 1)).toBeNull();
      expect(toggleCategorySelection(1, "1")).toBeNull();
    });

    it("returns null when targetId is null", () => {
      expect(toggleCategorySelection(1, null)).toBeNull();
    });
  });

  describe("getBrowseSectionTitle", () => {
    const categories = [
      { id: 1, name: "Rock", path: "Music / Rock" },
      { id: 2, name: "Jazz" },
    ];

    it("prioritizes debouncedSearch results count", () => {
      expect(getBrowseSectionTitle({
        categories,
        debouncedSearch: "muse",
        mediaCount: 3,
        selectedId: 1,
      })).toBe("Search results (3)");
    });

    it("returns category path or name when a category is selected", () => {
      expect(getBrowseSectionTitle({
        categories,
        debouncedSearch: "",
        mediaCount: 10,
        selectedId: 1,
      })).toBe("Music / Rock");

      expect(getBrowseSectionTitle({
        categories,
        debouncedSearch: "",
        mediaCount: 5,
        selectedId: 2,
      })).toBe("Jazz");
    });

    it("falls back to Browse when no category is selected", () => {
      expect(getBrowseSectionTitle({
        categories,
        debouncedSearch: "",
        mediaCount: 20,
        selectedId: null,
      })).toBe("Browse");
    });
  });
});
