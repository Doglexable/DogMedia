import { describe, expect, it } from "vitest";
import { actualMediaQuality, normalizeMediaQuality } from "./media-quality";

describe("mobile media quality preference", () => {
  it("defaults invalid and missing values to high", () => {
    expect(normalizeMediaQuality(null)).toBe("high");
    expect(normalizeMediaQuality("ultra")).toBe("high");
  });

  it("reports fallback without selecting a tier above the request", () => {
    expect(actualMediaQuality("high", ["low", "ori"])).toBe("low");
    expect(actualMediaQuality("low", ["med", "high", "ori"])).toBe("ori");
  });
});
