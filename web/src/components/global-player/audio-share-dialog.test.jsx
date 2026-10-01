import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AudioShareDialog } from "./audio-share-dialog";

describe("AudioShareDialog", () => {
  const dummyMedia = {
    id: 42,
    title: "Starlight Echoes",
    artists: "Cosmic Band",
    duration: 240,
    mime_type: "audio/mp3",
  };

  const dummyLyrics = {
    language: "en",
    segments: [
      { start: 10, end: 14, text: "Walking under neon skies" },
      { start: 15, end: 20, text: "Searching for the starlight in your eyes" },
      { start: 21, end: 25, text: "Electric memories drifting away" },
    ],
  };

  it("defaults to Lyric Card tab when lyrics are present in auto mode", () => {
    const markup = renderToStaticMarkup(
      <AudioShareDialog
        currentMedia={dummyMedia}
        duration={240}
        initialPosition={16}
        initialTab="auto"
        lyrics={dummyLyrics}
        lyricsLoading={false}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("Starlight Echoes");
    expect(markup).toContain("Lyric Card");
    expect(markup).toContain("10s Video Clip");
    expect(markup).toContain("audio-share-tab--active");
    expect(markup).toContain("lyrics-share-picker");
    expect(markup).toContain("Searching for the starlight in your eyes");
    expect(markup).toContain("1/5 lines selected");
    expect(markup).toContain("Share image");
  });

  it("defaults to 10s Clip tab when no lyrics are available", () => {
    const markup = renderToStaticMarkup(
      <AudioShareDialog
        currentMedia={dummyMedia}
        duration={240}
        initialPosition={30}
        initialTab="auto"
        lyrics={{ segments: [] }}
        lyricsLoading={false}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("Starlight Echoes");
    expect(markup).toContain("10s Video Clip");
    expect(markup).toContain("Your 10-second window");
    expect(markup).toContain("0:30–0:40");
    expect(markup).toContain('aria-label="Clip start time"');
    expect(markup).toContain('value="30"');
    expect(markup).toContain("Render 10s clip");
  });

  it("respects initialTab='clip' when lyrics are present", () => {
    const markup = renderToStaticMarkup(
      <AudioShareDialog
        currentMedia={dummyMedia}
        duration={240}
        initialPosition={15}
        initialTab="clip"
        lyrics={dummyLyrics}
        lyricsLoading={false}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("Your 10-second window");
    expect(markup).toContain("0:15–0:25");
    expect(markup).toContain("Choose a lyric to align clip start");
    expect(markup).toContain("Walking under neon skies");
    expect(markup).toContain("Render 10s clip");
  });

  it("respects initialTab='lyrics'", () => {
    const markup = renderToStaticMarkup(
      <AudioShareDialog
        currentMedia={dummyMedia}
        duration={240}
        initialPosition={10}
        initialTab="lyrics"
        lyrics={dummyLyrics}
        lyricsLoading={false}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("lyrics-share-preview-frame");
    expect(markup).toContain("Dogmedia");
    expect(markup).toContain("Walking under neon skies");
  });
});
