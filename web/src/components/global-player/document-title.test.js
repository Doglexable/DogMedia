import { describe, expect, it } from "vitest";
import { getPlaybackDocumentTitle } from "./document-title";

const media = { title: "Night Drive", artists: "The Dogs" };

describe("getPlaybackDocumentTitle", () => {
  it("keeps the current media title during ordinary playback", () => {
    expect(getPlaybackDocumentTitle({ media, isAudio: true })).toBe("Night Drive by The Dogs - Dogmedia");
    expect(getPlaybackDocumentTitle()).toBe("Dogmedia");
  });

  it("names the next playlist and first media when the completion dialog opens", () => {
    expect(getPlaybackDocumentTitle({
      media,
      isAudio: true,
      playlistSuggestion: {
        category: { name: "Season Two" },
        media: { title: "The Return" },
      },
    })).toBe("! Next playlist: Season Two — The Return - Dogmedia");
  });

  it("announces sleep timer completion before any playlist suggestion", () => {
    expect(getPlaybackDocumentTitle({
      media,
      sleepTimerCompleted: true,
      playlistSuggestion: { category: { name: "Season Two" } },
    })).toBe("! Sleep timer finished — Night Drive - Dogmedia");
  });

  it("shows an active sleep timer mode and remaining minutes", () => {
    expect(getPlaybackDocumentTitle({ media, sleepTimerMode: "playlist" }))
      .toBe("Sleep timer: after this playlist · Night Drive - Dogmedia");
    expect(getPlaybackDocumentTitle({ media, sleepTimerMode: "duration", sleepTimerRemaining: 601 }))
      .toBe("Sleep timer: 11 min left · Night Drive - Dogmedia");
  });
});
