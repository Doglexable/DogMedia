import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MusicReelDialog } from "./music-share-dialog";

describe("MusicReelDialog", () => {
  it("lets a single-track share begin at the current playback moment", () => {
    const markup = renderToStaticMarkup(
      <MusicReelDialog
        favorites={[{ id: 12, title: "Night Drive", artists: "The Dogs", duration: 180 }]}
        singleTrack
        duration={180}
        initialStart={28}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("Your 10-second window");
    expect(markup).toContain("0:28–0:38");
    expect(markup).toContain('aria-label="Clip start time"');
    expect(markup).toContain('value="28"');
    expect(markup).toContain("Loading timed lyrics…");
  });
});
