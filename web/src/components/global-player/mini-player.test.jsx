import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MiniPlayer } from "./mini-player";

describe("MiniPlayer", () => {
  it("suppresses rendering for photo or unsupported media", () => {
    const photoMarkup = renderToStaticMarkup(
      <MiniPlayer currentMedia={{ id: 2, title: "Test Photo", mime_type: "image/jpeg" }} />
    );
    expect(photoMarkup).toBe("");

    const unknownMarkup = renderToStaticMarkup(
      <MiniPlayer currentMedia={{ id: 3, title: "Document", mime_type: "application/pdf" }} />
    );
    expect(unknownMarkup).toBe("");
  });

  it("renders PlayerBar when active media is audio", () => {
    const audioMarkup = renderToStaticMarkup(
      <MiniPlayer
        currentMedia={{ id: 4, title: "My Song", mime_type: "audio/mp3", artists: "Muse" }}
        duration={180}
        position={45}
      />
    );
    expect(audioMarkup).toContain("My Song");
    expect(audioMarkup).toContain("Muse");
    expect(audioMarkup).toContain("themed-player-bar");
  });

  it("renders custom VideoMiniPlayer when active media is video and paused", () => {
    const videoMarkup = renderToStaticMarkup(
      <MiniPlayer
        currentMedia={{ id: 5, title: "Inception Movie", mime_type: "video/mp4", category_name: "Action" }}
        duration={7200}
        position={1800}
        paused={true}
        thumbSrc="/api/media/5/thumbnail"
        onToggle={vi.fn()}
        onSeek={vi.fn()}
        onOpenFull={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Root container & accessibility
    expect(videoMarkup).toContain("video-mini-player");
    expect(videoMarkup).toContain('aria-label="Mini player: Inception Movie"');

    // Title and category metadata
    expect(videoMarkup).toContain("Inception Movie");
    expect(videoMarkup).toContain("Action");

    // Timestamps
    expect(videoMarkup).toContain("30:00 / 02:00:00");

    // Scrubber & Controls
    expect(videoMarkup).toContain("video-mini-scrubber");
    expect(videoMarkup).toContain("video-mini-play-btn");
    expect(videoMarkup).toContain('aria-label="Play"');
    expect(videoMarkup).toContain("Rewind 10 seconds");
    expect(videoMarkup).toContain("Forward 10 seconds");
    expect(videoMarkup).toContain("Expand to fullscreen");
    expect(videoMarkup).toContain("Close video player");
  });

  it("displays pause control when video is unpaused", () => {
    const playingMarkup = renderToStaticMarkup(
      <MiniPlayer
        currentMedia={{ id: 6, title: "Interstellar", mime_type: "video/mkv" }}
        duration={600}
        position={120}
        paused={false}
      />
    );

    expect(playingMarkup).toContain("video-mini-player");
    expect(playingMarkup).toContain("video-mini-play-btn");
    expect(playingMarkup).toContain('aria-label="Pause"');
  });
});
