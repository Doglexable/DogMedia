import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShinyText } from "./ShinyText";

describe("ShinyText", () => {
  it("renders text content with correct classes and styles", () => {
    const markup = renderToStaticMarkup(
      <ShinyText text="NOW PLAYING" className="custom-shine" speed={4} />
    );

    expect(markup).toContain("NOW PLAYING");
    expect(markup).toContain("shiny-text");
    expect(markup).toContain("custom-shine");
    expect(markup).toContain("--shiny-speed:4s");
  });

  it("renders children when text prop is not provided", () => {
    const markup = renderToStaticMarkup(
      <ShinyText>Featured Video</ShinyText>
    );

    expect(markup).toContain("Featured Video");
  });
});
