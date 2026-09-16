import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MediaTypePills, MEDIA_TYPE_OPTIONS } from "./media-type-pills";

describe("MediaTypePills", () => {
  it("renders all media type options", () => {
    const markup = renderToStaticMarkup(<MediaTypePills value="all" />);

    for (const opt of MEDIA_TYPE_OPTIONS) {
      expect(markup).toContain(opt.label);
    }
    expect(markup).toContain("media-type-pills");
    expect(markup).toContain("media-type-pill");
  });

  it("marks active pill with active class and aria-selected", () => {
    const markupAll = renderToStaticMarkup(<MediaTypePills value="all" />);
    expect(markupAll).toContain('aria-selected="true"');
    expect(markupAll).toContain("media-type-pill--active");

    const markupAudio = renderToStaticMarkup(<MediaTypePills value="audio" />);
    expect(markupAudio).toContain('aria-selected="true"');
    expect(markupAudio).toContain("media-type-pill--active");
  });

  it("renders with fallback to all when value is undefined", () => {
    const markup = renderToStaticMarkup(<MediaTypePills />);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("media-type-pill--active");
  });
});
