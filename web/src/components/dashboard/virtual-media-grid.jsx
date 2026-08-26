import { useEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import MediaCard from "./media-card";

const MIN_CARD_WIDTH = 210;
const GAP = 16;

export function VirtualMediaGrid({
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

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hasMore || loadingMore || !sentinelRef.current) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onLoadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CARD_WIDTH + GAP)));
  const rowCount = Math.ceil(items.length / columns);
  const scrollMargin = containerRef.current?.offsetTop || 0;
  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => 310,
    overscan: 2,
    scrollMargin,
  });
  const rows = virtualizer.getVirtualItems();
  const cardWidth = width > 0 ? (width - GAP * (columns - 1)) / columns : MIN_CARD_WIDTH;
  const renderedRows = useMemo(() => rows.map((virtualRow) => ({
    virtualRow,
    rowItems: items.slice(virtualRow.index * columns, virtualRow.index * columns + columns),
  })), [columns, items, rows]);

  return (
    <section className="library-content-section" aria-label="Browse media">
      <div className="library-section-header"><h2>Browse</h2></div>
      <div ref={containerRef} style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {renderedRows.map(({ virtualRow, rowItems }) => (
          <div
            key={virtualRow.key}
            ref={virtualizer.measureElement}
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
      {loadingMore && <p role="status" className="text-center text-sm text-muted">Loading more media…</p>}
    </section>
  );
}
