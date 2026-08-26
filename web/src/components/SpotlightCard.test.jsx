import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SpotlightCard from "./SpotlightCard";

describe("SpotlightCard", () => {
  it("preserves application classes, content, and accessible attributes", () => {
    const markup = renderToStaticMarkup(
      <SpotlightCard className="featured" aria-label="Featured media">
        <h2>Current signal</h2>
      </SpotlightCard>
    );

    expect(markup).toContain("featured");
    expect(markup).toContain('aria-label="Featured media"');
    expect(markup).toContain("Current signal");
    expect(markup).toContain("radial-gradient");
  });
});
