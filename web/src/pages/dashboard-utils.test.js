import { describe, expect, it } from "vitest";
import { shouldShowBrowse } from "./dashboard-utils";

describe("dashboard browse visibility", () => {
  it("hides Browse when the current folder has eight or fewer media items", () => {
    expect(shouldShowBrowse({ mediaCount: 0 })).toBe(false);
    expect(shouldShowBrowse({ mediaCount: 8 })).toBe(false);
  });

  it("shows Browse when the current folder has more than eight media items", () => {
    expect(shouldShowBrowse({ mediaCount: 9 })).toBe(true);
  });

  it("keeps Browse available for search results regardless of count", () => {
    expect(shouldShowBrowse({ hasSearch: true, mediaCount: 1 })).toBe(true);
  });
});
