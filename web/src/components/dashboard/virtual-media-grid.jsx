import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import MediaCard from "./media-card";

const MIN_CARD_WIDTH = 210;
const GAP = 16;
// Estimated height of media card body + padding + borders + gap:
// cover (1:1 aspect ratio = cardWidth) + body content (~116px) + gap (16px)
const CARD_EXTRA_HEIGHT = 132;

export const VirtualMediaGrid = memo(function VirtualMediaGrid({
  activeId,
  hasMore,
  isLiked,
  items,
  loadingMore,
  onAddQueue,
  onLoadMore,
  onNotice,
  onPlay,
  onPlayNext,
  onToggleLike,
}) {
  const containerRef = useRef(null);
  const sentinelRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Measure container width and document-relative scroll margin
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const updateMeasurements = () => {
      if (!containerRef.current) return;
      setWidth(containerRef.current.clientWidth);
      const rect = containerRef.current.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      setScrollMargin(Math.max(0, top));
    };

    updateMeasurements();
    const observer = new ResizeObserver(() => updateMeasurements());
    observer.observe(element);
    window.addEventListener("resize", updateMeasurements, { passive: true });

    // Re-check after header/featured media images settle
    const t1 = setTimeout(updateMeasurements, 150);
    const t2 = setTimeout(updateMeasurements, 600);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateMeasurements);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CARD_WIDTH + GAP)));
  const rowCount = Math.ceil(items.length / columns);
  const cardWidth = width > 0 ? (width - GAP * (columns - 1)) / columns : MIN_CARD_WIDTH;
  const estimatedRowHeight = Math.round(cardWidth + CARD_EXTRA_HEIGHT);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => estimatedRowHeight,
    overscan: 4,
    scrollMargin,
  });

  const rows = virtualizer.getVirtualItems();

  // Proactively trigger load-more when scrolling near the end of loaded rows
  const lastVirtualRow = rows[rows.length - 1];
  useEffect(() => {
    if (!lastVirtualRow || !hasMore || loadingMore) return;
    if (lastVirtualRow.index >= rowCount - 3) {
      onLoadMore();
    }
  }, [lastVirtualRow?.index, rowCount, hasMore, loadingMore, onLoadMore]);

  // Fallback IntersectionObserver sentinel
  useEffect(() => {
    if (!hasMore || loadingMore || !sentinelRef.current) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onLoadMore();
    }, { rootMargin: "800px 0px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  const renderedRows = useMemo(() => rows.map((virtualRow) => ({
    virtualRow,
    rowItems: items.slice(virtualRow.index * columns, virtualRow.index * columns + columns),
  })), [columns, items, rows]);

  return (
    <section className="library-browse-section" aria-label="Browse media">
      <div className="library-section-header">
        <h2>Browse</h2>
      </div>

      <div
        ref={containerRef}
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {renderedRows.map(({ virtualRow, rowItems }) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            style={{
              display: "flex",
              gap: GAP,
              left: 0,
              paddingBottom: GAP,
              position: "absolute",
              top: 0,
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              width: "100%",
              willChange: "transform",
            }}
          >
            {rowItems.map((item) => (
              <div key={item.id} style={{ flex: `0 0 ${cardWidth}px`, minWidth: 0 }}>
                <MediaCard
                  item={item}
                  isActive={Number(activeId) === Number(item.id)}
                  isLiked={isLiked?.(item.id) || false}
                  onAddQueue={onAddQueue}
                  onError={onNotice}
                  onPlay={onPlay}
                  onPlayNext={onPlayNext}
                  onToggleLike={onToggleLike}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />

      {loadingMore && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted" role="status">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span>Loading more media…</span>
        </div>
      )}
    </section>
  );
});
