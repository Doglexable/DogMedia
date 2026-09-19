import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FullPlayer } from "./full-player";

describe("FullPlayer", () => {
  const dummyAudio = {
    id: 101,
    title: "Test Track",
    artists: "Test Artist",
    duration: 180,
    mime_type: "audio/mp3",
    file_path: "music/track.mp3",
    category_path: "Music",
  };

  const dummyMeta = {
    icon: {},
    label: "Audio",
  };

  it("renders audio FullPlayer with QualityControl, SleepTimerControl, and FullscreenLyrics without error", () => {
    const markup = renderToStaticMarkup(
      <FullPlayer
        autoPlay={false}
        currentMedia={dummyAudio}
        duration={180}
        hasNext={true}
        hasPrev={false}
        isAudio={true}
        isImage={false}
        isVideo={false}
        liked={false}
        loopMode="none"
        mediaRef={{ current: null }}
        meta={dummyMeta}
        muted={false}
        paused={false}
        position={30}
        queueOpen={false}
        resumePos={null}
        shuffleEnabled={false}
        sleepTimerRemaining={600}
        streamSrc="/api/media/101/stream"
        thumbFailed={false}
        thumbSrc="/api/media/101/thumbnail"
        volume={0.8}
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
        onThumbError={vi.fn()}
        onTimeUpdate={vi.fn()}
        onToggleLoop={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleShuffle={vi.fn()}
        onToggle={vi.fn()}
        onToggleLike={vi.fn()}
        onSetSleepTimer={vi.fn()}
      />
    );

    expect(markup).toContain("Test Track");
    expect(markup).toContain("player-quality-control");
    expect(markup).toContain("player-sleep-control");
    expect(markup).toContain("fullscreen-player");
    expect(markup).toContain('aria-keyshortcuts="Space"');
    expect(markup).toContain('title="Pause (Space)"');
    expect(markup).toContain('aria-label="Share music clip"');
  });
});
