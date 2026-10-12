import { useEffect, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons/faEllipsis";
import { faGripVertical } from "@fortawesome/free-solid-svg-icons/faGripVertical";
import { faMusic } from "@fortawesome/free-solid-svg-icons/faMusic";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { Drawer } from "vaul";
import { mediaThumbnailUrl } from "../../api";
import { formatDuration, getMediaFolderName, resolveMediaArtist } from "./player-utils";

const MOBILE_DRAWER_QUERY = "(max-width: 640px)";
const MAX_RENDER_ITEMS = 10;
const REFILL_THRESHOLD = 5;

function useMobileDrawer() {
  const [mobile, setMobile] = useState(() => (
    typeof window !== "undefined" && window.matchMedia(MOBILE_DRAWER_QUERY).matches
  ));

  useEffect(() => {
    const query = window.matchMedia(MOBILE_DRAWER_QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return mobile;
}

function QueueArtwork({ media, size = 44, overlayIcon = null, onClick }) {
  const [imgError, setImgError] = useState(false);
  const src = mediaThumbnailUrl(media);

  return (
    <div
      className="spotify-queue-thumb"
      style={{ width: size, height: size }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      {src && !imgError ? (
        <img
          src={src}
          alt={media?.title || "Artwork"}
          className="spotify-queue-thumb-img"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        <div className="spotify-queue-thumb-fallback">
          <FontAwesomeIcon icon={faMusic} />
        </div>
      )}
      {overlayIcon && (
        <div className="spotify-queue-thumb-overlay">
          <FontAwesomeIcon icon={overlayIcon} />
        </div>
      )}
    </div>
  );
}

function QueueListSkeleton({ count = 6 }) {
  return (
    <div role="status" aria-label="Loading queue" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="queue-item-skeleton" aria-hidden="true">
          <span className="skeleton-shimmer h-10 w-10 rounded" />
          <span className="grid gap-2 flex-1">
            <span className="skeleton-shimmer h-3.5 w-3/4 rounded" />
            <span className="skeleton-shimmer h-2.5 w-1/2 rounded" />
          </span>
          <span className="skeleton-shimmer h-3 w-8 rounded" />
        </div>
      ))}
    </div>
  );
}

function NowPlayingQueueItem({ item, paused = false, onTogglePlay, onRemove, onSelect }) {
  const artist = resolveMediaArtist(item, "Unknown artist");

  return (
    <div className="spotify-queue-now-playing" role="listitem">
      <QueueArtwork
        media={item}
        size={48}
        overlayIcon={paused ? faPlay : faPause}
        onClick={onTogglePlay || (() => onSelect(item))}
      />
      <button
        type="button"
        className="spotify-queue-meta"
        onClick={() => onSelect(item)}
        title={item.title}
      >
        <span className="spotify-queue-track-title">{item.title}</span>
        <span className="spotify-queue-artist" title={artist}>{artist}</span>
      </button>
      <button
        type="button"
        className="spotify-queue-ellipsis-btn"
        title="Remove from queue"
        aria-label={`Remove ${item.title}`}
        onClick={() => onRemove(item.id)}
      >
        <FontAwesomeIcon icon={faEllipsis} />
      </button>
    </div>
  );
}

function SortableQueueItem({ item, onRemove, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: Number(item.id),
  });
  const artist = resolveMediaArtist(item, "Unknown artist");

  return (
    <div
      ref={setNodeRef}
      className={`spotify-queue-item ${isDragging ? "is-dragging" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: "relative",
        zIndex: isDragging ? 2 : "auto",
      }}
      role="listitem"
    >
      <button
        type="button"
        className="spotify-queue-grip"
        aria-label={`Move ${item.title}`}
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <FontAwesomeIcon icon={faGripVertical} />
      </button>
      <QueueArtwork
        media={item}
        size={44}
        overlayIcon={faPlay}
        onClick={() => onSelect(item)}
      />
      <button
        type="button"
        className="spotify-queue-meta"
        onClick={() => onSelect(item)}
        title={item.title}
      >
        <span className="spotify-queue-track-title">{item.title}</span>
        <span className="spotify-queue-artist" title={artist}>{artist}</span>
      </button>
      {item.duration ? (
        <span className="spotify-queue-duration">
          {formatDuration(item.duration)}
        </span>
      ) : null}
      <button
        type="button"
        className="spotify-queue-ellipsis-btn"
        title="Remove from queue"
        aria-label={`Remove ${item.title}`}
        onClick={() => onRemove(item.id)}
      >
        <FontAwesomeIcon icon={faEllipsis} />
      </button>
    </div>
  );
}

function resolveCurrentIndex(items, currentIndex, currentMedia) {
  if (
    Number.isInteger(currentIndex)
    && currentIndex >= 0
    && currentIndex < items.length
    && (!currentMedia || Number(items[currentIndex]?.id) === Number(currentMedia.id))
  ) {
    return currentIndex;
  }
  return items.findIndex((item) => Number(item.id) === Number(currentMedia?.id));
}

export function QueuePanel({
  currentIndex = 0,
  currentMedia,
  items = [],
  loading = false,
  total = 0,
  paused = false,
  isOpen = true,
  isSidebar = false,
  onClear,
  onClose,
  onRemove,
  onReorder,
  onSelect,
  onTogglePlay,
  onFetchMore,
}) {
  const [error, setError] = useState("");
  const [snap, setSnap] = useState(0.88);
  const mobile = useMobileDrawer();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const run = (operation) => {
    setError("");
    Promise.resolve(operation).catch((err) => setError(err.message || "Queue update failed"));
  };

  const pinnedIndex = resolveCurrentIndex(items, currentIndex, currentMedia);
  const hasPinnedItem = pinnedIndex > -1;
  const pinnedItem = hasPinnedItem ? items[pinnedIndex] : currentMedia;
  const previousItems = hasPinnedItem ? items.slice(0, pinnedIndex) : [];
  const upcomingItems = hasPinnedItem
    ? items.slice(pinnedIndex + 1)
    : items.filter((item) => Number(item.id) !== Number(currentMedia?.id));

  // Limit render list to 10
  const visibleUpcoming = upcomingItems.slice(0, MAX_RENDER_ITEMS);
  const displayedTotal = loading ? total : (pinnedItem ? upcomingItems.length + 1 : items.length);

  // Auto-fetch 10 more items when remaining upcoming items in queue window reaches 5
  useEffect(() => {
    if (upcomingItems.length <= REFILL_THRESHOLD && total > items.length) {
      onFetchMore?.(10);
    }
  }, [upcomingItems.length, total, items.length, onFetchMore]);

  const handleRemove = (id) => {
    const nextUpcoming = upcomingItems.filter((item) => Number(item.id) !== Number(id));
    if (nextUpcoming.length <= REFILL_THRESHOLD && total > items.length) {
      onFetchMore?.(10);
    }
    run(onRemove(id));
  };

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    if (pinnedItem && Number(active.id) === Number(pinnedItem.id)) return;

    const oldIndex = visibleUpcoming.findIndex((item) => Number(item.id) === Number(active.id));
    const newIndex = visibleUpcoming.findIndex((item) => Number(item.id) === Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reorderedRendered = arrayMove(visibleUpcoming, oldIndex, newIndex);
    const unrenderedUpcoming = upcomingItems.slice(MAX_RENDER_ITEMS);
    const reorderedUpcoming = [...reorderedRendered, ...unrenderedUpcoming];

    const nextItems = hasPinnedItem
      ? [...previousItems, pinnedItem, ...reorderedUpcoming]
      : reorderedUpcoming;

    run(onReorder(nextItems.map((item) => Number(item.id))));
  };

  useEffect(() => {
    if (mobile) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobile, onClose]);

  const contextName = currentMedia?.album
    || getMediaFolderName(currentMedia)
    || currentMedia?.category_name
    || currentMedia?.category?.name
    || "Queue";

  const sidebarClass = isSidebar
    ? `spotify-queue-panel spotify-queue-panel--sidebar ${isOpen ? "spotify-queue-panel--sidebar-open" : "spotify-queue-panel--sidebar-closed"}`
    : "spotify-queue-panel";

  const panel = (
    <div
      role={mobile ? undefined : "region"}
      aria-label={mobile ? undefined : "Playback queue"}
      aria-hidden={!mobile && isSidebar && !isOpen ? true : undefined}
      className={mobile ? "spotify-queue-panel premium-queue-panel--drawer" : sidebarClass}
      onContextMenu={(event) => event.preventDefault()}
      style={mobile ? {
        position: "static",
        width: "100%",
        maxHeight: "none",
        flex: "1 1 auto",
        border: 0,
        borderRadius: 0,
        background: "transparent",
        boxShadow: "none",
      } : undefined}
    >
      <div className="spotify-queue-header">
        <div className="spotify-queue-title-text">Queue</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {displayedTotal > 0 && onClear && (
            <button
              type="button"
              className="spotify-queue-clear-btn"
              onClick={() => run(onClear())}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            aria-label="Close queue"
            className="spotify-queue-close-btn"
            onClick={onClose}
            title="Close queue"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ padding: "8px 14px", color: "var(--warning-text)", background: "var(--warning-bg)", fontSize: 12 }}>
          {error}
        </div>
      )}

      <div className="spotify-queue-scroll">
        {loading ? (
          <QueueListSkeleton count={Math.min(Math.max(total, 3), 6)} />
        ) : (
          <>
            {pinnedItem && (
              <>
                <div className="spotify-queue-section-header">Now playing</div>
                <NowPlayingQueueItem
                  item={pinnedItem}
                  paused={paused}
                  onTogglePlay={onTogglePlay}
                  onRemove={handleRemove}
                  onSelect={onSelect}
                />
              </>
            )}

            <div className="spotify-queue-section-header">
              Next from: {contextName}
            </div>

            {visibleUpcoming.length > 0 ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={visibleUpcoming.map((item) => Number(item.id))} strategy={verticalListSortingStrategy}>
                  <div role="list" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {visibleUpcoming.map((item) => (
                      <SortableQueueItem
                        key={item.id}
                        item={item}
                        onRemove={handleRemove}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div style={{ padding: "12px 6px", color: "var(--muted)", fontSize: 13 }}>
                No upcoming items.
              </div>
            )}

            {upcomingItems.length > MAX_RENDER_ITEMS && (
              <div className="spotify-queue-more-hint">
                +{upcomingItems.length - MAX_RENDER_ITEMS} more in queue
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  if (!mobile) return panel;

  return (
    <Drawer.Root
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      snapPoints={[0.5, 0.88]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      fadeFromIndex={0}
      autoFocus
      handleOnly
      shouldScaleBackground={false}
      setBackgroundColorOnScale={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="mobile-player-drawer-overlay" />
        <Drawer.Content className="mobile-player-drawer mobile-queue-drawer">
          <Drawer.Handle className="mobile-player-drawer-handle" />
          {panel}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
