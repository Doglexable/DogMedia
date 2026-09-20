import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlaylistCompleteDialog } from "./playlist-complete-dialog";

describe("PlaylistCompleteDialog", () => {
  it("presents a sibling-folder suggestion without implying it was queued", () => {
    const markup = renderToStaticMarkup(
      <PlaylistCompleteDialog
        suggestion={{
          category: { id: 7, name: "Season Two", path: "Shows / Season Two" },
          media: { id: 22, title: "The Return", artists: "Dogmedia Cast" },
        }}
        onDismiss={vi.fn()}
        onPlay={vi.fn()}
      />
    );

    expect(markup).toContain("Playlist complete");
    expect(markup).toContain("Nothing has been added to your queue");
    expect(markup).toContain("Next folder · Season Two");
    expect(markup).toContain("The Return");
    expect(markup).toContain("Play suggestion");
  });
});
