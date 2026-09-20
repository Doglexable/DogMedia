import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { copyTextToClipboard, MusicReelDialog } from "./music-share-dialog";

describe("copyTextToClipboard", () => {
  it("uses the modern Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(copyTextToClipboard("https://example.test/share", {
      navigatorObject: { clipboard: { writeText } },
      documentObject: null,
    })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://example.test/share");
  });

  it("falls back to a selected textarea when Clipboard is unavailable", async () => {
    const textarea = {
      style: {},
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove: vi.fn(),
    };
    const documentObject = {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => true),
    };

    await expect(copyTextToClipboard("fallback text", {
      navigatorObject: {},
      documentObject,
    })).resolves.toBe(true);
    expect(textarea.value).toBe("fallback text");
    expect(textarea.select).toHaveBeenCalled();
    expect(documentObject.execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalled();
  });

  it("reports unsupported copying without throwing", async () => {
    await expect(copyTextToClipboard("manual copy", {
      navigatorObject: {},
      documentObject: null,
    })).resolves.toBe(false);
  });
});

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
