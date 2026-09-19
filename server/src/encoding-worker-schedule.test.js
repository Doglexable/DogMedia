import { describe, expect, it } from "vitest";
import { isEncodingWindowOpen, millisecondsUntilEncodingWindow } from "./encoding-worker.js";

describe("resolution encoder nightly schedule", () => {
  it("opens from local midnight until 05:00", () => {
    expect(isEncodingWindowOpen(new Date(2026, 0, 1, 0, 0), 0, 5)).toBe(true);
    expect(isEncodingWindowOpen(new Date(2026, 0, 1, 4, 59), 0, 5)).toBe(true);
    expect(isEncodingWindowOpen(new Date(2026, 0, 1, 5, 0), 0, 5)).toBe(false);
    expect(isEncodingWindowOpen(new Date(2026, 0, 1, 23, 59), 0, 5)).toBe(false);
  });

  it("calculates the next local midnight and returns zero inside the window", () => {
    expect(millisecondsUntilEncodingWindow(new Date(2026, 0, 1, 4, 59), 0, 5)).toBe(0);
    expect(millisecondsUntilEncodingWindow(new Date(2026, 0, 1, 23, 0), 0, 5)).toBe(60 * 60 * 1000);
    expect(millisecondsUntilEncodingWindow(new Date(2026, 0, 1, 5, 0), 0, 5)).toBe(19 * 60 * 60 * 1000);
  });
});
