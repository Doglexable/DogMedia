import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DepthCarousel, {
  getDepthCarouselScale,
  normalizeCarouselIndex,
} from "./DepthCarousel";

describe("DepthCarousel", () => {
  it("renders arbitrary story content with accessible controls and indicators", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({ id: `slide-${index + 1}` }));
    const html = renderToStaticMarkup(
      <DepthCarousel
        ariaLabel="Wrapped story"
        items={items}
        renderItem={(item) => <article data-story-id={item.id}>{item.id}</article>}
        initialIndex={0}
        loop={false}
      />
    );

    expect(html).toContain('aria-label="Wrapped story"');
    expect(html.match(/aria-roledescription="slide"/g)).toHaveLength(7);
    expect(html.match(/role="tab"/g)).toHaveLength(7);
    expect(html).toContain('data-story-id="slide-7"');
    expect(html).toMatch(/depth-carousel__arrow--prev[^>]*disabled/);
    expect(html).not.toMatch(/depth-carousel__arrow--next[^>]*disabled/);
  });

  it("disables the forward boundary when the final non-looping slide is initial", () => {
    const html = renderToStaticMarkup(
      <DepthCarousel items={["one", "two", "three"]} initialIndex={2} loop={false} />
    );

    expect(html).not.toMatch(/depth-carousel__arrow--prev[^>]*disabled/);
    expect(html).toMatch(/depth-carousel__arrow--next[^>]*disabled/);
    expect(html).toContain('aria-selected="true"');
  });
});

describe("DepthCarousel helpers", () => {
  it("clamps story navigation and wraps only when looping is enabled", () => {
    expect(normalizeCarouselIndex(-1, 7, false)).toBe(0);
    expect(normalizeCarouselIndex(8, 7, false)).toBe(6);
    expect(normalizeCarouselIndex(-1, 7, true)).toBe(6);
    expect(normalizeCarouselIndex(7, 7, true)).toBe(0);
  });

  it("fits a 9:16 card against both container dimensions", () => {
    const base = { cardHeight: 768, cardWidth: 432, spread: 78 };
    expect(getDepthCarouselScale({ ...base, containerHeight: 700, containerWidth: 390 })).toBeCloseTo(390 / 590);
    expect(getDepthCarouselScale({ ...base, containerHeight: 403, containerWidth: 1000 })).toBeCloseTo(403 / 816);
    expect(getDepthCarouselScale({ ...base, containerHeight: 100, containerWidth: 100 })).toBe(0.3);
  });
});
