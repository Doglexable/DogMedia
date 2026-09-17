import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  function renderFooter(props = {}) {
    return renderToStaticMarkup(
      <MemoryRouter>
        <SiteFooter {...props} />
      </MemoryRouter>
    );
  }

  it("renders semantic footer with role contentinfo and accessible label", () => {
    const markup = renderFooter();
    expect(markup).toContain("<footer");
    expect(markup).toContain('role="contentinfo"');
    expect(markup).toContain('aria-label="Site footer"');
  });

  it("renders brand logo, name, and core philosophy statements", () => {
    const markup = renderFooter();
    expect(markup).toContain("/web-app-manifest-192x192.png");
    expect(markup).toContain("DogMedia");
    expect(markup).toContain("Koleksimu, ceritamu, ritmemu sendiri.");
    expect(markup).toContain("Your media. Your space. Your story. Your rhythm.");
  });

  it("renders all 4 sitemap navigation groups with semantic headings", () => {
    const markup = renderFooter();
    expect(markup).toContain("Product");
    expect(markup).toContain("Platform");
    expect(markup).toContain("Resources");
    expect(markup).toContain("Legal &amp; Privacy");

    // Key routes
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/?view=liked"');
    expect(markup).toContain('href="/wrapped"');
  });

  it("renders platform utility shortcuts row with icons and labels", () => {
    const markup = renderFooter();
    expect(markup).toContain('aria-label="Platform utility shortcuts"');
    expect(markup).toContain("Web Player");
    expect(markup).toContain("Android APK");
    expect(markup).toContain("LAN Streaming");
    expect(markup).toContain("Self-Hosted");
    expect(markup).toContain("Repository");
  });

  it("renders accessible social links with aria labels", () => {
    const markup = renderFooter();
    expect(markup).toContain('aria-label="GitHub Repository"');
    expect(markup).toContain('aria-label="Discord Community"');
    expect(markup).toContain('aria-label="X (formerly Twitter)"');
  });

  it("renders the oversized brand wordmark wrapped in an overflow-protected container", () => {
    const markup = renderFooter();
    expect(markup).toContain("site-footer-wordmark-wrap");
    expect(markup).toContain("site-footer-wordmark");
    expect(markup).toContain("DOGMEDIA");
  });

  it("renders fine print with dynamic current year copyright", () => {
    const currentYear = new Date().getFullYear();
    const markup = renderFooter();
    expect(markup).toContain(`© ${currentYear} DogMedia. All rights reserved.`);
  });

  it("shows Admin Console link when access tier is >= 100 and hides it for standard users", () => {
    const standardMarkup = renderFooter({ access: { tier: 0 } });
    expect(standardMarkup).not.toContain("Admin Console");

    const adminMarkup = renderFooter({ access: { tier: 100 } });
    expect(adminMarkup).toContain("Admin Console");
    expect(adminMarkup).toContain('href="/admin"');
  });

  it("ensures site-footer.css includes content-visibility and contain-intrinsic-size for CLS prevention", () => {
    const cssPath = path.resolve(__dirname, "./site-footer.css");
    const css = fs.readFileSync(cssPath, "utf8");
    expect(css).toContain("content-visibility: auto;");
    expect(css).toContain("contain-intrinsic-size: auto 600px;");
  });

  it("ensures site-footer.css does NOT contain any hardcoded hex, rgb, or hsl colors", () => {
    const cssPath = path.resolve(__dirname, "./site-footer.css");
    const css = fs.readFileSync(cssPath, "utf8");

    // Check for hardcoded hex colors (#fff, #123456, etc.)
    const hexMatches = css.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(hexMatches).toBeNull();

    // Check for rgb or rgba colors
    const rgbMatches = css.match(/rgba?\([^)]+\)/g);
    expect(rgbMatches).toBeNull();

    // Check for hsl or hsla colors
    const hslMatches = css.match(/hsla?\([^)]+\)/g);
    expect(hslMatches).toBeNull();
  });
});
