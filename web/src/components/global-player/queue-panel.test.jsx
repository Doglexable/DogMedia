import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QueuePanel } from "./queue-panel";

describe("QueuePanel (Spotify Redesign)", () => {
  const currentMedia = {
    id: 1,
    title: "New Born",
    artists: "Muse",
    album: "Origin of Symmetry",
    duration: 363,
  };

  const createUpcomingItems = (count) =>
    Array.from({ length: count }, (_, i) => ({
      id: i + 2,
      title: `Upcoming Track ${i + 1}`,
      artists: "Muse",
      album: "Origin of Symmetry",
      duration: 200 + i * 10,
    }));

  it("renders Now playing section with active media title and artist", () => {
    const markup = renderToStaticMarkup(
      <QueuePanel
        currentMedia={currentMedia}
        items={[currentMedia, ...createUpcomingItems(3)]}
        currentIndex={0}
        total={4}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("Now playing");
    expect(markup).toContain("New Born");
    expect(markup).toContain("Muse");
    expect(markup).toContain("spotify-queue-now-playing");
  });

  it("renders Next from section heading using media album or category context", () => {
    const markup = renderToStaticMarkup(
      <QueuePanel
        currentMedia={currentMedia}
        items={[currentMedia, ...createUpcomingItems(3)]}
        currentIndex={0}
        total={4}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("Next from: Origin of Symmetry");
  });

  it("limits rendered list in upcoming queue to 10 items", () => {
    // 1 current media + 14 upcoming items = 15 items total from server
    const upcoming14 = createUpcomingItems(14);
    const markup = renderToStaticMarkup(
      <QueuePanel
        currentMedia={currentMedia}
        items={[currentMedia, ...upcoming14]}
        currentIndex={0}
        total={15}
        onClose={vi.fn()}
      />
    );

    // Should render first 10 upcoming items
    expect(markup).toContain("Upcoming Track 1");
    expect(markup).toContain("Upcoming Track 10");

    // Should NOT render upcoming track 11 onwards in the visible list
    expect(markup).not.toContain("Upcoming Track 11");
    expect(markup).not.toContain("Upcoming Track 14");

    // Should render the more hint indicating 4 more items in queue
    expect(markup).toContain("+4 more in queue");
  });

  it("renders drag handle grip button for drag-and-drop reordering", () => {
    const markup = renderToStaticMarkup(
      <QueuePanel
        currentMedia={currentMedia}
        items={[currentMedia, ...createUpcomingItems(2)]}
        currentIndex={0}
        total={3}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("spotify-queue-grip");
    expect(markup).toContain('title="Drag to reorder"');
  });

  it("renders ellipsis actions button for queue items", () => {
    const markup = renderToStaticMarkup(
      <QueuePanel
        currentMedia={currentMedia}
        items={[currentMedia, ...createUpcomingItems(2)]}
        currentIndex={0}
        total={3}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("spotify-queue-ellipsis-btn");
    expect(markup).toContain('title="Remove from queue"');
  });

  it("renders empty message when no upcoming items exist", () => {
    const markup = renderToStaticMarkup(
      <QueuePanel
        currentMedia={currentMedia}
        items={[currentMedia]}
        currentIndex={0}
        total={1}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("Now playing");
    expect(markup).toContain("No upcoming items.");
  });

  it("applies spotify-queue-panel--sidebar-open class when isSidebar is true and isOpen is true", () => {
    const markup = renderToStaticMarkup(
      <QueuePanel
        currentMedia={currentMedia}
        items={[currentMedia, ...createUpcomingItems(2)]}
        currentIndex={0}
        total={3}
        isSidebar={true}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("spotify-queue-panel--sidebar");
    expect(markup).toContain("spotify-queue-panel--sidebar-open");
    expect(markup).not.toContain("spotify-queue-panel--sidebar-closed");
  });

  it("applies spotify-queue-panel--sidebar-closed class and aria-hidden when isSidebar is true and isOpen is false", () => {
    const markup = renderToStaticMarkup(
      <QueuePanel
        currentMedia={currentMedia}
        items={[currentMedia, ...createUpcomingItems(2)]}
        currentIndex={0}
        total={3}
        isSidebar={true}
        isOpen={false}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain("spotify-queue-panel--sidebar");
    expect(markup).toContain("spotify-queue-panel--sidebar-closed");
    expect(markup).toContain('aria-hidden="true"');
  });
});
