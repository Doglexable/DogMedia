import { describe, expect, it } from "vitest";
import { LyricsValidationError, normalizeWhisperLyrics } from "./lyrics.js";

describe("normalizeWhisperLyrics", () => {
  it("keeps line timing and drops Whisper diagnostic data", () => {
    const result = normalizeWhisperLyrics({
      text: "Ignored full text",
      language: " en ",
      segments: [
        {
          id: 1,
          seek: 100,
          start: 4.5,
          end: 7.25,
          text: " Second line ",
          tokens: [1, 2],
          temperature: 0,
          words: [{ word: "Second", start: 4.5, end: 5.2, probability: 0.9 }],
        },
        { id: 0, start: 1, end: 3, text: " First line " },
      ],
    });

    expect(result).toEqual({
      language: "en",
      segments: [
        { start: 1, end: 3, text: "First line" },
        { start: 4.5, end: 7.25, text: "Second line" },
      ],
    });
  });

  it("discards blank segments", () => {
    expect(normalizeWhisperLyrics({
      segments: [
        { start: 0, end: 1, text: "   " },
        { start: 1, end: 2, text: "Keep me" },
      ],
    }).segments).toEqual([{ start: 1, end: 2, text: "Keep me" }]);
  });

  it.each([
    null,
    {},
    { segments: [{ start: -1, end: 2, text: "Invalid" }] },
    { segments: [{ start: 2, end: 1, text: "Invalid" }] },
    { segments: [{ start: 0, end: 1, text: "" }] },
  ])("rejects malformed lyrics %#", (payload) => {
    expect(() => normalizeWhisperLyrics(payload)).toThrow(LyricsValidationError);
  });
});

