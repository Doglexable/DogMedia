import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SharedMusic, {
  SharedMusicHeader,
  SharedMusicLoading,
  SharedMusicError,
  SharedReelProcessing,
  SharedReelPlayer,
} from "./SharedMusic";

describe("SharedMusic React Bits components", () => {
  it("renders header with Dogmedia logo, brand title, and ShinyText badge", () => {
    const markup = renderToString(<SharedMusicHeader singleTrack={true} />);

    expect(markup).toContain('src="/web-app-manifest-192x192.png"');
    expect(markup).toContain("Dogmedia");
    expect(markup).toContain("Music Clip");
    expect(markup).toContain("Private Stream");
    expect(markup).toContain("magnet-wrapper");
  });

  it("renders header with Favorite Reel badge for multi-track share", () => {
    const markup = renderToString(<SharedMusicHeader singleTrack={false} />);

    expect(markup).toContain("Favorite Reel");
  });

  it("renders loading state with equalizer and ShinyText subtitle in SpotlightCard", () => {
    const markup = renderToString(<SharedMusicLoading />);

    expect(markup).toContain("shared-music-state-card");
    expect(markup).toContain("shared-music-loading-equalizer");
    expect(markup).toContain("Opening the favorite reel…");
    expect(markup).toContain("Loading chunk stream and metadata");
  });

  it("renders error state with retry action wrapped in Magnet and SpotlightCard", () => {
    const markup = renderToString(
      <SharedMusicError error="This reel has expired" onRetry={() => {}} />
    );

    expect(markup).toContain("shared-music-state-card--error");
    expect(markup).toContain("This reel is not available");
    expect(markup).toContain("This reel has expired");
    expect(markup).toContain("Try again");
    expect(markup).toContain("magnet-wrapper");
  });

  it("renders processing state with countdown progress and animation indicators", () => {
    const markup = renderToString(
      <SharedReelProcessing status="processing" progress={65} />
    );

    expect(markup).toContain("shared-reel-processing-card");
    expect(markup).toContain("RENDERING");
    expect(markup).toContain("65");
    expect(markup).toContain("Turning each favorite into a 10-second scene.");
    expect(markup).toContain('style="width:65%"');
    expect(markup).toContain("No refresh needed");
  });

  it("renders showcase player with SpotlightCards, SplitText title, and Magnet download button", () => {
    const sampleData = {
      streamUrl: "/api/public/stream/reel-10.mp4",
      downloadUrl: "/api/public/download/reel-10.mp4",
      shareExpiresAt: "2026-09-25T12:00:00Z",
      tracks: [
        {
          position: 1,
          title: "DRIVING MY LOVE",
          artists: "Anri",
        },
      ],
    };

    const markup = renderToString(
      <SharedReelPlayer data={sampleData} singleTrack={true} />
    );

    expect(markup).toContain("shared-reel-media-card");
    expect(markup).toContain("shared-reel-info-card");
    expect(markup).toContain("shared-reel-media-glow");
    expect(markup).toContain("<video");
    expect(markup).toContain("4:3");
    expect(markup).toContain("SEC");
    expect(markup).toContain("SHARED MUSIC CLIP");
    expect(markup).toContain("split-text");
    expect(markup).toContain('aria-label="Ten seconds from this track."');
    expect(markup).toContain("DRIVING MY LOVE");
    expect(markup).toContain("Anri");
    expect(markup).toContain("shared-reel-download-btn");
    expect(markup).toContain("Download MP4");
    expect(markup).toContain("magnet-wrapper");
  });

  it("renders initial container page with Squares background canvas", () => {
    const markup = renderToString(<SharedMusic />);

    expect(markup).toContain("shared-music-bg-canvas");
    expect(markup).toContain("squares-canvas");
    expect(markup).toContain("Dogmedia");
    expect(markup).toContain("Opening the favorite reel…");
  });
});
