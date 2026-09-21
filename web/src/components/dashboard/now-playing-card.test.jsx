import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  NowPlayingCard,
  fmtDur,
  playbackDisplayPosition,
  playbackProgressPercent,
  playbackStateLabels,
} from "./now-playing-card";

describe("NowPlayingCard helpers", () => {
  it("fmtDur formats seconds into mm:ss strings", () => {
    expect(fmtDur(0)).toBe("0:00");
    expect(fmtDur(65)).toBe("1:05");
    expect(fmtDur(3599)).toBe("59:59");
    expect(fmtDur(null)).toBe("0:00");
    expect(fmtDur(undefined)).toBe("0:00");
    expect(fmtDur(-10)).toBe("0:00");
  });

  it("playbackDisplayPosition calculates elapsed position during play", () => {
    const session = {
      action: "play",
      position: 30,
      duration: 100,
      timestamp: new Date(1000000).toISOString(),
    };

    // 10 seconds later
    const nowMs = 1000000 + 10000;
    expect(playbackDisplayPosition(session, nowMs)).toBe(40);

    // 120 seconds later (clamped to duration)
    const wayLaterMs = 1000000 + 120000;
    expect(playbackDisplayPosition(session, wayLaterMs)).toBe(100);
  });

  it("playbackDisplayPosition does not advance when paused", () => {
    const session = {
      action: "pause",
      position: 30,
      duration: 100,
      timestamp: new Date(1000000).toISOString(),
    };
    const nowMs = 1000000 + 10000;
    expect(playbackDisplayPosition(session, nowMs)).toBe(30);
  });

  it("playbackProgressPercent calculates percentages clamped between 0 and 100", () => {
    expect(playbackProgressPercent(0, 100)).toBe(0);
    expect(playbackProgressPercent(50, 100)).toBe(50);
    expect(playbackProgressPercent(150, 100)).toBe(100);
    expect(playbackProgressPercent(50, 0)).toBe(0);
    expect(playbackProgressPercent(-10, 100)).toBe(0);
  });

  it("playbackStateLabels extracts loop and shuffle modes", () => {
    expect(playbackStateLabels({})).toEqual([]);
    expect(playbackStateLabels({ loopMode: "queue" })).toEqual(["loop queue"]);
    expect(playbackStateLabels({ loopMode: "media", shuffleEnabled: true })).toEqual([
      "loop media",
      "shuffle",
    ]);
  });
});

describe("NowPlayingCard component", () => {
  it("renders session details and progress bar", () => {
    const session = {
      ip: "192.168.1.10",
      mediaId: 42,
      action: "play",
      title: "Cyberpunk City",
      duration: 180,
      position: 60,
      timestamp: new Date().toISOString(),
      loopMode: "queue",
      shuffleEnabled: true,
    };

    const markup = renderToStaticMarkup(<NowPlayingCard session={session} index={0} />);

    expect(markup).toContain("192.168.1.10");
    expect(markup).toContain("Cyberpunk City");
    expect(markup).toContain("Media #42");
    expect(markup).toContain("magic-bento-now-playing__status--play");
    expect(markup).toContain("magic-bento-now-playing__fill");
    expect(markup).toContain("loop queue");
    expect(markup).toContain("shuffle");
    expect(markup).toContain("3:00");
  });

  it("falls back to media ID when title is absent", () => {
    const session = {
      ip: "10.0.0.1",
      mediaId: 99,
      action: "pause",
      duration: 120,
      position: 10,
    };

    const markup = renderToStaticMarkup(<NowPlayingCard session={session} index={1} />);

    expect(markup).toContain("Media #99");
    expect(markup).toContain("magic-bento-now-playing__status--pause");
  });
});
