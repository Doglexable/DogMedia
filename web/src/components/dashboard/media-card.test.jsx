import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnimatedList, AnimatedListItem } from "./animated-list";
import MediaCard from "./media-card";

const audioItem = {
  id: 42,
  title: "Night Drive",
  artist: "The Satellites",
  category_path: "Music / Favorites",
  created_at: "2026-09-23T12:00:00.000Z",
  duration: 3900,
  mime_type: "audio/flac",
};

describe("dashboard animated media list", () => {
  it("renders a text-only playlist hierarchy, actions, and hour-aware duration", () => {
    const markup = renderToStaticMarkup(
      <MediaCard
        index={3}
        item={audioItem}
        isActive
        isLiked
        onPlay={() => {}}
      />,
    );

    expect(markup).toContain("media-track--active");
    expect(markup).toContain("Night Drive");
    expect(markup).toContain("The Satellites");
    expect(markup).toContain("Music / Favorites");
    expect(markup).toContain("01:05:00");
    expect(markup).toContain('aria-label="Play Night Drive"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("/thumbnail");
  });

  it("keeps AnimatedList semantics and stagger metadata", () => {
    const markup = renderToStaticMarkup(
      <AnimatedList className="media-track-list">
        <AnimatedListItem index={4}>Track</AnimatedListItem>
      </AnimatedList>,
    );

    expect(markup).toContain('role="list"');
    expect(markup).toContain('role="listitem"');
    expect(markup).toContain("--animated-list-order:4");
  });

  it("uses project color tokens throughout the new list styles", () => {
    const cssPath = path.resolve(__dirname, "../../vault-theme.css");
    const css = fs.readFileSync(cssPath, "utf8");
    const listStyles = css.slice(
      css.indexOf("/* Animated media list:"),
      css.indexOf("/* Media cards:"),
    );

    expect(listStyles).toContain("var(--hover-fill)");
    expect(listStyles).toContain("var(--card-border)");
    expect(listStyles).toContain("var(--playback-signal)");
    expect(listStyles.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(listStyles.match(/rgba?\([^)]+\)/g)).toBeNull();
    expect(listStyles.match(/hsla?\([^)]+\)/g)).toBeNull();
  });
});
