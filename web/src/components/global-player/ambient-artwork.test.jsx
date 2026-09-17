import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AmbientArtwork } from "./ambient-artwork";
import { AlbumArt } from "./album-art";
import { PlayerBar } from "./player-bar";

describe("AmbientArtwork & AlbumArt LCP optimization", () => {
  it("renders ambient glow via CSS custom property instead of a DOM img element", () => {
    const markup = renderToStaticMarkup(
      <AmbientArtwork
        src="/api/media/42/thumbnail"
        alt="Track Title"
        priority
      />
    );

    // Ambient glow is applied purely via CSS variable, avoiding Chromium LCP candidate misattribution
    expect(markup).toContain('--ambient-glow-src:url(&quot;/api/media/42/thumbnail&quot;)');
    expect(markup).toContain('class="ambient-artwork__image"');
    expect(markup).toContain('src="/api/media/42/thumbnail"');

    // Crucial: no <img class="ambient-artwork__glow"> should exist in the DOM
    expect(markup).not.toContain('class="ambient-artwork__glow"');
    const glowImgMatch = markup.match(/<img[^>]*class="ambient-artwork__glow"[^>]*>/);
    expect(glowImgMatch).toBeNull();
  });

  it("applies fetchpriority=high, loading=eager, and decoding=async to the primary surface image when priority is true", () => {
    const markup = renderToStaticMarkup(
      <AmbientArtwork
        src="/api/media/42/thumbnail"
        alt="Track Title"
        priority
        width={64}
        height={64}
      />
    );

    const surfaceImageMatch = markup.match(/<img[^>]*class="ambient-artwork__image"[^>]*>/);
    expect(surfaceImageMatch).not.toBeNull();
    expect(surfaceImageMatch[0]).toMatch(/fetchpriority="high"/i);
    expect(surfaceImageMatch[0]).toContain('loading="eager"');
    expect(surfaceImageMatch[0]).toContain('decoding="async"');
    expect(surfaceImageMatch[0]).not.toContain('loading="lazy"');
    expect(surfaceImageMatch[0]).toContain('alt="Track Title"');
    expect(surfaceImageMatch[0]).toContain('width="64"');
    expect(surfaceImageMatch[0]).toContain('height="64"');
  });

  it("renders fallback when src is missing and omits --ambient-glow-src", () => {
    const markup = renderToStaticMarkup(
      <AmbientArtwork
        src=""
        alt="No Art"
        fallback={<span className="custom-fallback">No Cover</span>}
      />
    );

    expect(markup).not.toContain("--ambient-glow-src");
    expect(markup).not.toContain("ambient-artwork__image");
    expect(markup).not.toContain("ambient-artwork__glow");
    expect(markup).toContain("custom-fallback");
    expect(markup).toContain("No Cover");
  });

  it("AlbumArt defaults priority to true, passes 64x64 dimensions, and renders within ambient-artwork-button when onClick is passed", () => {
    const handleClick = vi.fn();
    const markup = renderToStaticMarkup(
      <AlbumArt
        src="/api/media/10/thumbnail"
        alt="Album Cover"
        onClick={handleClick}
      />
    );

    expect(markup).toContain('class="ambient-artwork-button');
    expect(markup).toContain('aria-label="Open Album Cover"');
    expect(markup).toContain('class="ambient-artwork ambient-artwork--player-bar');
    expect(markup).toContain('--ambient-glow-src:url(&quot;/api/media/10/thumbnail&quot;)');
    expect(markup).toMatch(/fetchpriority="high"/i);
    expect(markup).toContain('loading="eager"');
    expect(markup).toContain('width="64"');
    expect(markup).toContain('height="64"');
    expect(markup).not.toContain('class="ambient-artwork__glow"');
  });

  it("PlayerBar renders without decorative img.ambient-artwork__glow, eliminating Lighthouse LCP audit failure", () => {
    const currentMedia = {
      id: 99,
      title: "Bohemian Rhapsody",
      mime_type: "audio/mp3",
      artists: "Queen",
    };

    const markup = renderToStaticMarkup(
      <PlayerBar
        currentMedia={currentMedia}
        thumbSrc="/api/media/99/thumbnail"
        duration={354}
        position={120}
        onOpenFull={() => {}}
      />
    );

    // Must match outer container hierarchy
    expect(markup).toContain('class="order-1 flex min-w-0 items-center gap-3"');
    expect(markup).toContain('class="ambient-artwork-button');
    expect(markup).toContain('class="ambient-artwork ambient-artwork--player-bar');

    // Must NOT contain the flagged img.ambient-artwork__glow selector
    expect(markup).not.toContain('class="ambient-artwork__glow"');
    const glowImgMatch = markup.match(/<img[^>]*class="ambient-artwork__glow"[^>]*>/);
    expect(glowImgMatch).toBeNull();

    // Primary artwork image has high priority eager loading
    const imgMatch = markup.match(/<img[^>]*class="ambient-artwork__image"[^>]*>/);
    expect(imgMatch).not.toBeNull();
    expect(imgMatch[0]).toMatch(/fetchpriority="high"/i);
    expect(imgMatch[0]).toContain('loading="eager"');
    expect(imgMatch[0]).not.toContain('loading="lazy"');
  });
});
