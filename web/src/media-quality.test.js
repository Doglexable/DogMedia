import { describe, expect, it } from "vitest";
import { actualMediaQuality, readMediaQuality } from "./media-quality";

describe("web media quality preference", () => {
  it("defaults to high and reads a persisted choice", () => {
    expect(readMediaQuality({ getItem: () => null })).toBe("high");
    expect(readMediaQuality({ getItem: () => "med" })).toBe("med");
  });

  it("shows the quality that will actually be served", () => {
    expect(actualMediaQuality("high", ["low", "med", "ori"])).toBe("med");
    expect(actualMediaQuality("med", ["high", "ori"])).toBe("ori");
  });
});
