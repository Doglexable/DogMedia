import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Squares from "./Squares";

describe("Squares", () => {
  it("renders a canvas with accessible hidden attributes and custom class", () => {
    const markup = renderToStaticMarkup(
      <Squares className="custom-squares" squareSize={50} />
    );

    expect(markup).toContain("<canvas");
    expect(markup).toContain('class="squares-canvas custom-squares"');
    expect(markup).toContain('aria-hidden="true"');
  });
});
