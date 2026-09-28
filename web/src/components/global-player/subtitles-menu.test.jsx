import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatLanguageLabel, SubtitlesMenu } from "./subtitles-menu";

describe("formatLanguageLabel", () => {
  it("formats standard language codes to friendly localized names", () => {
    expect(formatLanguageLabel("ind")).toBe("Indonesia");
    expect(formatLanguageLabel("eng")).toBe("Inggris");
    expect(formatLanguageLabel("jpn")).toBe("Jepang");
  });

  it("handles unknown or empty codes safely", () => {
    expect(formatLanguageLabel("")).toBe("Unknown");
    expect(formatLanguageLabel(null)).toBe("Unknown");
    expect(formatLanguageLabel("und")).toBe("Unknown");
  });
});

describe("SubtitlesMenu", () => {
  it("returns null when no subtitles are present", () => {
    const markup = renderToStaticMarkup(
      <SubtitlesMenu subtitles={[]} selectedSubtitleId={null} />
    );
    expect(markup).toBe("");
  });

  it("renders trigger button when subtitles are available", () => {
    const subs = [
      { id: 1, language: "ind", title: "Emot", hasAssStyling: true },
      { id: 2, language: "eng", title: "English", hasAssStyling: false },
    ];
    const markup = renderToStaticMarkup(
      <SubtitlesMenu subtitles={subs} selectedSubtitleId={null} />
    );
    expect(markup).toContain("video-player-ctrl-btn");
    expect(markup).toContain("Subtitles &amp; Captions");
    expect(markup).not.toContain("video-player-ctrl-btn--active");
  });

  it("adds active class when a subtitle is selected", () => {
    const subs = [
      { id: 1, language: "ind", title: "Emot", hasAssStyling: true },
    ];
    const markup = renderToStaticMarkup(
      <SubtitlesMenu subtitles={subs} selectedSubtitleId={1} />
    );
    expect(markup).toContain("video-player-ctrl-btn--active");
  });
});
