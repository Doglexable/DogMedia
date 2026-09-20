import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VideoPlayer } from "./video-player";

describe("VideoPlayer", () => {
  const dummyMedia = {
    id: 114,
    title: "DWI-REJEKI-UBE",
    duration: 10,
    mime_type: "video/mp4",
    file_path: "13/114.mp4",
    created_at: "2026-09-16T10:04:33Z",
    category_path: "Film",
    folder: "Film",
  };

  const dummyMeta = {
    icon: {},
    label: "Video",
  };

  it("renders video element, ShinyText title, controls, and metadata", () => {
    const markup = renderToStaticMarkup(
      <VideoPlayer
        autoPlay={false}
        currentMedia={dummyMedia}
        duration={10}
        hasNext={true}
        hasPrev={false}
        liked={false}
        loopMode="none"
        mediaRef={{ current: null }}
        meta={dummyMeta}
        muted={false}
        paused={true}
        position={2}
        queueOpen={false}
        resumePos={null}
        sleepTimerRemaining={null}
        streamSrc="/api/media/114/stream"
        volume={0.85}
        quality="ori"
        actualQuality="ori"
        onChangeQuality={vi.fn()}
        onAdvance={vi.fn()}
        onChangeVolume={vi.fn()}
        onEnded={vi.fn()}
        onLoadedMetadata={vi.fn()}
        onCloseFull={vi.fn()}
        onOpenQueue={vi.fn()}
        onPause={vi.fn()}
        onPlay={vi.fn()}
        onPreventMenu={vi.fn()}
        onResume={vi.fn()}
        onSeek={vi.fn()}
        onTimeUpdate={vi.fn()}
        onToggleLoop={vi.fn()}
        onToggleMute={vi.fn()}
        onToggle={vi.fn()}
        onToggleLike={vi.fn()}
        onSetSleepTimer={vi.fn()}
      />
    );

    expect(markup).toContain("video-player-root");
    expect(markup).toContain("DWI-REJEKI-UBE");
    expect(markup).toContain("video-player-video");
    expect(markup).toContain("/api/media/114/stream");
    expect(markup).toContain("shiny-text");
    expect(markup).not.toContain("magnet-wrapper");
    expect(markup).toContain('aria-keyshortcuts="Space"');
    expect(markup).toContain('title="Play (Space)"');
    expect(markup).not.toContain("video-player-hud-badge");
    expect(markup).not.toContain("now-playing-sidebar");
  });

  it("renders resume prompt when resumePos is present", () => {
    const markup = renderToStaticMarkup(
      <VideoPlayer
        autoPlay={false}
        currentMedia={dummyMedia}
        duration={10}
        hasNext={false}
        hasPrev={false}
        liked={false}
        loopMode="none"
        mediaRef={{ current: null }}
        meta={dummyMeta}
        muted={false}
        paused={true}
        position={0}
        queueOpen={false}
        resumePos={4}
        sleepTimerRemaining={null}
        streamSrc="/api/media/114/stream"
        volume={0.85}
        quality="ori"
        actualQuality="ori"
        onChangeQuality={vi.fn()}
        onAdvance={vi.fn()}
        onChangeVolume={vi.fn()}
        onEnded={vi.fn()}
        onLoadedMetadata={vi.fn()}
        onCloseFull={vi.fn()}
        onOpenQueue={vi.fn()}
        onPause={vi.fn()}
        onPlay={vi.fn()}
        onPreventMenu={vi.fn()}
        onResume={vi.fn()}
        onSeek={vi.fn()}
        onTimeUpdate={vi.fn()}
        onToggleLoop={vi.fn()}
        onToggleMute={vi.fn()}
        onToggle={vi.fn()}
        onToggleLike={vi.fn()}
        onSetSleepTimer={vi.fn()}
      />
    );

    expect(markup).toContain("Resume from 0:04");
  });
});
