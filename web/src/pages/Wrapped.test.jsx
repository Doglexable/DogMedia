import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StorySlide } from "./Wrapped";

describe("Wrapped StorySlide branding", () => {
  it("renders the DogMedia logo in opening slide", () => {
    const markup = renderToString(
      <StorySlide
        data={{ totalPlayTime: 120, topMedia: [{ mediaId: 1, title: "Test Track" }] }}
        periodLabel="Jan 1 - Jan 30"
        slide={{ id: "opening" }}
        timeline={[]}
      />
    );
    expect(markup).toContain('src="/web-app-manifest-192x192.png"');
    expect(markup).toContain('class="wrapped-slide-logo"');
    expect(markup).toContain("DogMedia");
  });

  it("renders the DogMedia logo in final share slide", () => {
    const markup = renderToString(
      <StorySlide
        data={{ totalPlayTime: 120, totalPlays: 8, topMedia: [{ mediaId: 1, title: "Test Track" }] }}
        periodLabel="Jan 1 - Jan 30"
        slide={{ id: "share" }}
        timeline={[]}
      />
    );
    expect(markup).toContain('src="/web-app-manifest-192x192.png"');
    expect(markup).toContain('class="wrapped-slide-logo"');
    expect(markup).toContain("DogMedia");
  });

  it("renders the DogMedia logo brand tag across intermediate slides", () => {
    const intermediateSlides = [
      { id: "time", expectedKicker: "Time in motion" },
      { id: "top-media", expectedKicker: "Your rotation" },
      { id: "rhythm", expectedKicker: "Your listening clock" },
      { id: "devices", expectedKicker: "All-device contribution" },
      { id: "persona", expectedKicker: "Your playback character" },
    ];

    for (const slide of intermediateSlides) {
      const markup = renderToString(
        <StorySlide
          data={{ totalPlayTime: 120, totalPlays: 8, topMedia: [] }}
          periodLabel="Jan 1 - Jan 30"
          slide={slide}
          timeline={[]}
        />
      );
      expect(markup).toContain('src="/web-app-manifest-192x192.png"');
      expect(markup).toContain('class="wrapped-slide-logo"');
      expect(markup).toContain(slide.expectedKicker);
    }
  });
});
