import { describe, expect, it } from "vitest";
import { shouldShowBrowse } from "./dashboard-utils";

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
