import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CategoryIcon, CategorySidebarItem } from "./library-shell";

describe("CategoryIcon", () => {
  it("renders a thumbnail image when cover_path exists on category", () => {
    const markup = renderToStaticMarkup(
      <CategoryIcon category={{ id: 7, name: "Muse", cover_path: "7/front.webp" }} />
    );

    expect(markup).toContain("<img");
    expect(markup).toContain('class="global-sidebar-category-thumb"');
    expect(markup).toContain('src="/api/categories/7/thumbnail?v=7%2Ffront.webp"');
    expect(markup).toContain("global-sidebar-category-icon-slot");
  });

  it("renders a folder icon when cover_path is null or missing", () => {
    const markupNull = renderToStaticMarkup(
      <CategoryIcon category={{ id: 2, name: "Rock", cover_path: null }} />
    );

    expect(markupNull).not.toContain("<img");
    expect(markupNull).toContain("global-sidebar-link-icon");
    expect(markupNull).toContain("global-sidebar-category-icon-slot");

    const markupUndefined = renderToStaticMarkup(
      <CategoryIcon category={{ id: 3, name: "Jazz" }} />
    );
    expect(markupUndefined).not.toContain("<img");
    expect(markupUndefined).toContain("global-sidebar-link-icon");
  });
});

describe("CategorySidebarItem", () => {
  it("renders category link with artwork thumbnail when cover is attached", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CategorySidebarItem
          category={{ id: 12, name: "No Need To Argue", cover_path: "12/front.webp", depth: 0 }}
          active={false}
          close={() => {}}
          onOpenMenu={() => {}}
        />
      </MemoryRouter>
    );

    expect(markup).toContain("No Need To Argue");
    expect(markup).toContain('href="/?category=12"');
    expect(markup).toContain('src="/api/categories/12/thumbnail?v=12%2Ffront.webp"');
    expect(markup).toContain("global-sidebar-category-thumb");
  });

  it("renders category link with default folder icon when no cover is attached", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CategorySidebarItem
          category={{ id: 4, name: "Evanescence", cover_path: null, depth: 1 }}
          active={true}
          close={() => {}}
          onOpenMenu={() => {}}
        />
      </MemoryRouter>
    );

    expect(markup).toContain("Evanescence");
    expect(markup).toContain('href="/?category=4"');
    expect(markup).not.toContain("<img");
    expect(markup).toContain("global-sidebar-link-icon");
    expect(markup).toContain("global-sidebar-link--active");
  });
});
