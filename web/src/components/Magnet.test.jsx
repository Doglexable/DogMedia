import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Magnet } from "./Magnet";

describe("Magnet", () => {
  it("renders children with magnet wrapper class and styles", () => {
    const markup = renderToStaticMarkup(
      <Magnet className="btn-magnet">
        <button type="button">Play</button>
      </Magnet>
    );

    expect(markup).toContain("magnet-wrapper");
    expect(markup).toContain("btn-magnet");
    expect(markup).toContain("<button");
    expect(markup).toContain("Play</button>");
  });
});
