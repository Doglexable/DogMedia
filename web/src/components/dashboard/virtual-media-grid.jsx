import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClock } from "@fortawesome/free-solid-svg-icons/faClock";
import { AnimatedList, AnimatedListItem } from "./animated-list";
import MediaCard from "./media-card";

const DESKTOP_ROW_HEIGHT = 56;
const MOBILE_ROW_HEIGHT = 60;

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
  const [width, setWidth] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 0));
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

  const isMobile = width > 0 ? width <= 640 : (typeof window !== "undefined" && window.innerWidth <= 640);
  const rowCount = items.length;
  const estimatedRowHeight = isMobile ? MOBILE_ROW_HEIGHT : DESKTOP_ROW_HEIGHT;

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
    item: items[virtualRow.index],
    virtualRow,
  })), [items, rows]);

  return (
    <section className="library-browse-section" aria-label="Browse media">
      <div className="library-section-header">
        <h2>Browse</h2>
      </div>

      <div className="media-track-list-shell">
        <div className="media-track-list-header" aria-hidden="true">
          <div className="media-track-header-main">
            <span className="media-track-index-heading">#</span>
            <span>Title</span>
            <span className="media-track-folder-heading">Folder</span>
            <span className="media-track-added-heading">Added</span>
            <span className="media-track-duration-heading"><FontAwesomeIcon icon={faClock} /></span>
          </div>
          <span />
        </div>

        <AnimatedList
          ref={containerRef}
          className="media-track-list"
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {renderedRows.map(({ item, virtualRow }) => (
            <AnimatedListItem
              key={virtualRow.key}
              index={virtualRow.index}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="media-track-virtual-row"
              style={{
                left: 0,
                position: "absolute",
                top: 0,
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                width: "100%",
                willChange: "transform",
              }}
            >
              <MediaCard
                index={virtualRow.index + 1}
                item={item}
                isActive={Number(activeId) === Number(item.id)}
                isLiked={isLiked?.(item.id) || false}
                onAddQueue={onAddQueue}
                onError={onNotice}
                onPlay={onPlay}
                onPlayNext={onPlayNext}
                onToggleLike={onToggleLike}
              />
            </AnimatedListItem>
          ))}
        </AnimatedList>
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
