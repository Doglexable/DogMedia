import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  QualityControl,
  SleepTimerControl,
  TransportControls,
  VolumeControl,
  formatBitrate,
  getQualityBitrateLabel,
} from "./player-controls";

describe("SleepTimerControl", () => {
  it("renders with popover closed by default and shows presets", () => {
    const onSetSleepTimer = vi.fn();
    const markup = renderToStaticMarkup(
      <SleepTimerControl
        remainingSeconds={0}
        onSetSleepTimer={onSetSleepTimer}
      />
    );

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain("player-sleep-control");
    expect(markup).not.toContain("player-sleep-control--open");
    expect(markup).not.toContain("player-sleep-badge");
    expect(markup).toContain("5m");
    expect(markup).toContain("15m");
    expect(markup).toContain("30m");
    expect(markup).toContain("45m");
    expect(markup).toContain("60m");
  });

  it("renders active badge and active class when timer is set", () => {
    const onSetSleepTimer = vi.fn();
    const markup = renderToStaticMarkup(
      <SleepTimerControl
        remainingSeconds={1800}
        onSetSleepTimer={onSetSleepTimer}
      />
    );

    expect(markup).toContain("player-sleep-control--active");
    expect(markup).toContain("player-sleep-badge");
    expect(markup).toContain("30:00");
  });

  it("applies variant button classes correctly", () => {
    const fullscreenMarkup = renderToStaticMarkup(
      <SleepTimerControl
        remainingSeconds={300}
        onSetSleepTimer={vi.fn()}
        variant="fullscreen"
      />
    );
    expect(fullscreenMarkup).toContain("fullscreen-player-icon-button");
    expect(fullscreenMarkup).toContain("player-sleep-control--fullscreen");

    const videoMarkup = renderToStaticMarkup(
      <SleepTimerControl
        remainingSeconds={300}
        onSetSleepTimer={vi.fn()}
        variant="video-ctrl"
      />
    );
    expect(videoMarkup).toContain("video-player-ctrl-btn");
    expect(videoMarkup).toContain("player-sleep-control--video-ctrl");
  });
});

describe("QualityControl", () => {
  it("renders with popover closed by default and shows all options", () => {
    const onChangeQuality = vi.fn();
    const markup = renderToStaticMarkup(
      <QualityControl
        quality="ori"
        actualQuality="ori"
        onChangeQuality={onChangeQuality}
      />
    );

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain("player-quality-control");
    expect(markup).not.toContain("player-quality-control--open");
    expect(markup).toContain("Original");
    expect(markup).toContain("High");
    expect(markup).toContain("Medium");
    expect(markup).toContain("Low");
  });

  it("applies variant classes correctly", () => {
    const fullscreenMarkup = renderToStaticMarkup(
      <QualityControl
        quality="high"
        onChangeQuality={vi.fn()}
        variant="fullscreen"
      />
    );
    expect(fullscreenMarkup).toContain("fullscreen-player-icon-button");
    expect(fullscreenMarkup).toContain("player-quality-control--fullscreen");

    const videoMarkup = renderToStaticMarkup(
      <QualityControl
        quality="high"
        onChangeQuality={vi.fn()}
        variant="video-ctrl"
      />
    );
    expect(videoMarkup).toContain("video-player-ctrl-btn");
    expect(videoMarkup).toContain("player-quality-control--video-ctrl");
  });

  it("formats bitrates and labels properly", () => {
    expect(formatBitrate(5_000_000)).toBe("5 Mbps");
    expect(formatBitrate(256_000)).toBe("256 kbps");

    const videoMedia = { mime_type: "video/mp4" };
    expect(getQualityBitrateLabel("high", videoMedia)).toContain("1080p");
    expect(getQualityBitrateLabel("ori", videoMedia)).toBe("Original");

    const audioMedia = { mime_type: "audio/mp3" };
    expect(getQualityBitrateLabel("high", audioMedia)).toBe("256 kbps");
  });
});

describe("VolumeControl", () => {
  it("renders with popover closed by default, aria attributes, and slider/mute inside popover", () => {
    const onChangeVolume = vi.fn();
    const onToggleMute = vi.fn();
    const markup = renderToStaticMarkup(
      <VolumeControl
        volume={0.8}
        muted={false}
        onChangeVolume={onChangeVolume}
        onToggleMute={onToggleMute}
      />
    );

    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain("player-volume-control");
    expect(markup).not.toContain("player-volume-control--open");
    expect(markup).not.toContain("player-volume-control--muted");
    expect(markup).toContain("player-volume-popover");
    expect(markup).toContain("player-volume-popover-mute");
    expect(markup).toContain("player-volume-range");
    expect(markup).toContain("80%");
  });

  it("renders muted class and 0% when muted", () => {
    const markup = renderToStaticMarkup(
      <VolumeControl
        volume={0.8}
        muted={true}
        onChangeVolume={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    expect(markup).toContain("player-volume-control--muted");
    expect(markup).toContain("0%");
  });

  it("suppresses rendering for image media", () => {
    const markup = renderToStaticMarkup(
      <VolumeControl
        isImage={true}
        volume={0.8}
        muted={false}
        onChangeVolume={vi.fn()}
        onToggleMute={vi.fn()}
      />
    );

    expect(markup).toBe("");
  });
});

describe("TransportControls", () => {
  it("renders play button with aria-keyshortcuts='Space' and title='Play (Space)' when paused", () => {
    const onToggle = vi.fn();
    const markup = renderToStaticMarkup(
      <TransportControls
        hasNext={true}
        hasPrev={false}
        isImage={false}
        paused={true}
        onAdvance={vi.fn()}
        onToggle={onToggle}
      />
    );

    expect(markup).toContain('aria-keyshortcuts="Space"');
    expect(markup).toContain('aria-label="Play"');
    expect(markup).toContain('title="Play (Space)"');
  });

  it("renders pause button with aria-keyshortcuts='Space' and title='Pause (Space)' when playing", () => {
    const markup = renderToStaticMarkup(
      <TransportControls
        hasNext={true}
        hasPrev={true}
        isImage={false}
        paused={false}
        onAdvance={vi.fn()}
        onToggle={vi.fn()}
      />
    );

    expect(markup).toContain('aria-keyshortcuts="Space"');
    expect(markup).toContain('aria-label="Pause"');
    expect(markup).toContain('title="Pause (Space)"');
  });

  it("does not bind space shortcut to open action when media is an image", () => {
    const markup = renderToStaticMarkup(
      <TransportControls
        hasNext={false}
        hasPrev={false}
        isImage={true}
        paused={true}
        onAdvance={vi.fn()}
        onToggle={vi.fn()}
      />
    );

    expect(markup).not.toContain('aria-keyshortcuts="Space"');
    expect(markup).toContain('aria-label="Open media"');
    expect(markup).toContain('title="Open media"');
  });
});

