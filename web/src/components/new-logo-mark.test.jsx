import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NewLogoMark } from "./new-logo-mark";

describe("NewLogoMark", () => {
  it("draws two curved waves and a play triangle with spans only", () => {
    const markup = renderToStaticMarkup(<NewLogoMark />);

    expect(markup.match(/dm-new-logo-curve--/g)).toHaveLength(2);
    expect(markup).toContain("dm-new-logo-play");
    expect(markup).toContain("dogmedia");
    expect(markup).not.toMatch(/<(img|svg|i)\b/);
  });

  it("supports a compact symbol without the wordmark", () => {
    const markup = renderToStaticMarkup(<NewLogoMark showName={false} />);

    expect(markup).toContain('aria-label="Dogmedia"');
    expect(markup).not.toContain("dm-new-logo-word");
  });

  it("can be decorative when a nearby link already names Dogmedia", () => {
    const markup = renderToStaticMarkup(<NewLogoMark showName={false} decorative />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('aria-label="Dogmedia"');
  });
});
