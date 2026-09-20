import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SplitText from "./SplitText";

describe("SplitText", () => {
  it("splits text into words and letters with split-text classes", () => {
    const markup = renderToStaticMarkup(
      <SplitText text="Ten seconds from this track." className="headline" />
    );

    expect(markup).toContain("split-text");
    expect(markup).toContain("headline");
    expect(markup).toContain("split-text-char");
    expect(markup).toContain('aria-label="Ten seconds from this track."');
    expect(markup).toContain(">T<");
    expect(markup).toContain(">e<");
    expect(markup).toContain(">n<");
  });
});
