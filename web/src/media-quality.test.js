import { describe, expect, it } from "vitest";
import { actualMediaQuality, readMediaQuality, visibleMediaQualities } from "./media-quality";

describe("web media quality preference", () => {
  it("defaults to high and reads a persisted choice", () => {
    expect(readMediaQuality({ getItem: () => null })).toBe("high");
    expect(readMediaQuality({ getItem: () => "med" })).toBe("med");
  });

  it("shows the quality that will actually be served", () => {
    expect(actualMediaQuality("high", ["low", "med", "ori"])).toBe("med");
    expect(actualMediaQuality("med", ["high", "ori"])).toBe("high");
    expect(actualMediaQuality("high", [])).toBeNull();
  });

  it("only offers ready qualities when the server reports availability", () => {
    expect(visibleMediaQualities(["low", "ori"])).toEqual(["low", "ori"]);
    expect(visibleMediaQualities([])).toEqual([]);
    expect(visibleMediaQualities()).toEqual(["low", "med", "high", "ori"]);
  });
});
