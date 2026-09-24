import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  NowPlayingFloatingPill,
  NowPlayingPanel,
} from "./now-playing-panel";

describe("NowPlayingFloatingPill", () => {
  it("returns null when count is 0", () => {
    const markup = renderToStaticMarkup(
      <NowPlayingFloatingPill count={0} firstSession={null} onClick={() => {}} />
    );
    expect(markup).toBe("");
  });

  it("renders pill with session title and count when count > 0", () => {
    const session = {
      title: "Midnight City",
      ip: "192.168.1.15",
      mediaId: 101,
      action: "play",
    };
    const markup = renderToStaticMarkup(
      <NowPlayingFloatingPill count={1} firstSession={session} onClick={() => {}} />
    );
    expect(markup).toContain("now-playing-floating-pill");
    expect(markup).toContain("Midnight City");
    expect(markup).toContain("1 active");
  });
});

describe("NowPlayingPanel", () => {
  it("renders empty state when there are no active sessions", () => {
    const markup = renderToStaticMarkup(
      <NowPlayingPanel sessions={[]} onClose={() => {}} />
    );
    expect(markup).toContain("now-playing-floating-panel");
    expect(markup).toContain("No active sessions");
    expect(markup).toContain("0 active");
  });

  it("renders active session cards when sessions exist", () => {
    const mockSessions = [
      {
        ip: "10.0.0.5",
        mediaId: 88,
        action: "play",
        title: "Synthwave Sunset",
        duration: 210,
        position: 45,
      },
    ];

    const markup = renderToStaticMarkup(
      <NowPlayingPanel sessions={mockSessions} onClose={() => {}} />
    );

    expect(markup).toContain("Synthwave Sunset");
    expect(markup).toContain("10.0.0.5");
    expect(markup).toContain("Media #88");
    expect(markup).toContain("1 active");
  });
});
