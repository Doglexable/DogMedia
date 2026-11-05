import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BottomNavTab, CategoryIcon, CategorySidebarItem } from "./library-shell";
import { faCircleUser } from "@fortawesome/free-solid-svg-icons/faCircleUser";

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

  it("renders folder actions for direct media and for a parent with media in subfolders", () => {
    const withMedia = renderToStaticMarkup(
      <MemoryRouter>
        <CategorySidebarItem
          category={{ id: 8, name: "Showbiz", depth: 1, media_count: 3 }}
          active={false}
          close={() => {}}
          onOpenMenu={() => {}}
        />
      </MemoryRouter>
    );
    const empty = renderToStaticMarkup(
      <MemoryRouter>
        <CategorySidebarItem
          category={{ id: 9, name: "Empty", depth: 1, media_count: 0 }}
          active={false}
          close={() => {}}
          onOpenMenu={() => {}}
        />
      </MemoryRouter>
    );
    const parentWithMediaInSubfolders = renderToStaticMarkup(
      <MemoryRouter>
        <CategorySidebarItem
          category={{ id: 10, name: "Albums", depth: 0, media_count: 0 }}
          hasMedia
          active={false}
          close={() => {}}
          onOpenMenu={() => {}}
        />
      </MemoryRouter>
    );

    expect(withMedia).toContain("Open actions for Showbiz");
    expect(parentWithMediaInSubfolders).toContain("Open actions for Albums");
    expect(empty).not.toContain("Open actions for Empty");
  });
});

describe("BottomNavTab", () => {
  it("renders with avatar image when avatarUrl is provided", () => {
    const markup = renderToStaticMarkup(
      <BottomNavTab
        icon={faCircleUser}
        avatarUrl="/api/profile-pictures/fine?size=s"
        onClick={() => {}}
      >
        Profile
      </BottomNavTab>
    );

    expect(markup).toContain('class="mobile-nav-tab-avatar"');
    expect(markup).toContain('src="/api/profile-pictures/fine?size=s"');
    expect(markup).toContain("Profile</span>");
  });

  it("renders with icon when avatarUrl is absent", () => {
    const markup = renderToStaticMarkup(
      <BottomNavTab icon={faCircleUser} onClick={() => {}}>
        Profile
      </BottomNavTab>
    );

    expect(markup).not.toContain('class="mobile-nav-tab-avatar"');
    expect(markup).toContain("mobile-nav-tab-icon");
    expect(markup).toContain("Profile</span>");
  });
});
