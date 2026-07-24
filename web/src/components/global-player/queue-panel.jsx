import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGripVertical, faTrash, faXmark } from "@fortawesome/free-solid-svg-icons";
import { playerStyles as styles } from "./player-styles";
import { formatDuration, getMediaMeta } from "./player-utils";

function QueueListSkeleton({ count }) {
  return (
    <div role="status" aria-label="Loading queue" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="queue-item-skeleton" aria-hidden="true">
          <span className="skeleton-shimmer h-7 w-7 rounded-md" />
          <span className="skeleton-shimmer h-3 w-4 rounded" />
          <span className="grid gap-2">
            <span className="skeleton-shimmer h-3 w-3/4 rounded" />
            <span className="skeleton-shimmer h-2.5 w-1/2 rounded" />
          </span>
          <span className="skeleton-shimmer h-3 w-8 rounded" />
          <span className="skeleton-shimmer h-7 w-7 rounded-md" />
        </div>
      ))}
    </div>
  );
}

function SortableQueueItem({ active, index, item, onRemove, onSelect }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: Number(item.id),
    disabled: { draggable: active },
  });
  const meta = getMediaMeta(item.mime_type || "");
  return (
    <div
      ref={setNodeRef}
      style={{
        ...styles.queueItem(active),
        gridTemplateColumns: "32px 26px minmax(0, 1fr) auto auto",
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.65 : active ? 0.82 : 1,
        position: "relative",
        zIndex: isDragging ? 1 : "auto",
      }}
    >
      <button
        type="button"
        aria-label={active ? `${item.title} is currently playing and cannot be moved` : `Move ${item.title}`}
        title={active ? "Now playing — locked in place" : "Drag to reorder"}
        disabled={active}
        style={{ ...styles.queueActionButton, cursor: active ? "not-allowed" : "grab", opacity: active ? 0.45 : 1 }}
        {...attributes}
        {...listeners}
      >
        <FontAwesomeIcon icon={faGripVertical} />
      </button>
      <span style={{ color: active ? "var(--primary)" : "var(--muted)", fontSize: 12, fontWeight: 800 }}>
        {index + 1}
      </span>
      <button type="button" style={styles.queueSelectButton} onClick={() => onSelect(item)} title={item.title}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 700 }}>
          {item.title}
        </span>
        <span
          title={active ? "Now Playing · Locked" : `${meta.label} · ${item.mime_type || "Unknown MIME type"}`}
          style={{ display: "block", marginTop: 2, overflow: "hidden", color: "var(--muted)", fontSize: 11, textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {active ? "Now Playing · Locked" : `${meta.label} · ${item.mime_type || "Unknown MIME type"}`}
        </span>
      </button>
      <span style={{ color: "var(--muted)", fontSize: 12 }}>
        {item.duration ? formatDuration(item.duration) : ""}
      </span>
      <button type="button" aria-label={`Remove ${item.title}`} title="Remove from queue" style={styles.queueActionButton} onClick={() => onRemove(item.id)}>
        <FontAwesomeIcon icon={faTrash} />
      </button>
    </div>
  );
}

function PinnedQueueItem({ index, item, onRemove, onSelect }) {
  const meta = getMediaMeta(item.mime_type || "");
  return (
    <div
      style={{
        ...styles.queueItem(true),
        gridTemplateColumns: "32px 26px minmax(0, 1fr) auto auto",
        opacity: 0.92,
      }}
    >
      <button
        type="button"
        aria-label={`${item.title} is currently playing and cannot be moved`}
        title="Now playing — locked in place"
        disabled
        style={{ ...styles.queueActionButton, cursor: "not-allowed", opacity: 0.45 }}
      >
        <FontAwesomeIcon icon={faGripVertical} />
      </button>
      <span style={{ color: "var(--primary)", fontSize: 12, fontWeight: 800 }}>
        {index + 1}
      </span>
      <button type="button" style={styles.queueSelectButton} onClick={() => onSelect(item)} title={item.title}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 700 }}>
          {item.title}
        </span>
        <span
          title={`Now Playing · Locked · ${meta.label}`}
          style={{ display: "block", marginTop: 2, overflow: "hidden", color: "var(--muted)", fontSize: 11, textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          Now Playing · Locked
        </span>
      </button>
      <span style={{ color: "var(--muted)", fontSize: 12 }}>
        {item.duration ? formatDuration(item.duration) : ""}
      </span>
      <button type="button" aria-label={`Remove ${item.title}`} title="Remove from queue" style={styles.queueActionButton} onClick={() => onRemove(item.id)}>
        <FontAwesomeIcon icon={faTrash} />
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

export function QueuePanel({ currentIndex = 0, currentMedia, items, loading, total, onClear, onClose, onRemove, onReorder, onSelect }) {
  const [error, setError] = useState("");
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
  const pinnedItem = hasPinnedItem ? items[pinnedIndex] : null;
  const previousItems = hasPinnedItem ? items.slice(0, pinnedIndex) : [];
  const upcomingItems = hasPinnedItem ? items.slice(pinnedIndex + 1) : items;
  const displayedTotal = loading ? total : (hasPinnedItem ? upcomingItems.length + 1 : items.length);

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    if (hasPinnedItem && Number(active.id) === Number(pinnedItem.id)) return;
    const oldIndex = upcomingItems.findIndex((item) => Number(item.id) === Number(active.id));
    const newIndex = upcomingItems.findIndex((item) => Number(item.id) === Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const reorderedUpcoming = arrayMove(upcomingItems, oldIndex, newIndex);
    const nextItems = hasPinnedItem
      ? [...previousItems, pinnedItem, ...reorderedUpcoming]
      : reorderedUpcoming;
    run(onReorder(nextItems.map((item) => Number(item.id))));
  };

  return (
    <div className="premium-queue-panel" style={styles.queuePanel}>
      <div style={styles.queueHeader}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Queue</div>
          <div style={{ marginTop: 2, fontSize: 12, color: "var(--muted)" }}>
            {displayedTotal ? `${displayedTotal} item${displayedTotal === 1 ? "" : "s"} queued` : "No items queued"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {total > 0 && <button type="button" style={styles.queueClearButton} onClick={() => run(onClear())}>Clear</button>}
          <button type="button" style={styles.iconButton()} onClick={onClose} title="Close queue">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      </div>

      {error && <div role="alert" style={{ padding: "8px 14px", color: "var(--warning-text)", background: "var(--warning-bg)", fontSize: 12 }}>{error}</div>}
      <div style={styles.queueList}>
        {loading ? (
          <QueueListSkeleton count={Math.min(Math.max(total, 3), 6)} />
        ) : items.length > 0 ? (
          <>
            {pinnedItem && (
              <PinnedQueueItem
                index={pinnedIndex}
                item={pinnedItem}
                onRemove={(id) => run(onRemove(id))}
                onSelect={onSelect}
              />
            )}
            {upcomingItems.length > 0 && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={upcomingItems.map((item) => Number(item.id))} strategy={verticalListSortingStrategy}>
                  {upcomingItems.map((item, index) => (
                    <SortableQueueItem
                      key={item.id}
                      active={false}
                      index={hasPinnedItem ? pinnedIndex + index + 1 : index}
                      item={item}
                      onRemove={(id) => run(onRemove(id))}
                      onSelect={onSelect}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
            {pinnedItem && upcomingItems.length === 0 && (
              <div style={{ padding: "10px 2px 2px", color: "var(--muted)", fontSize: 12 }}>No upcoming items.</div>
            )}
          </>
        ) : (
          <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>Queue is empty.</div>
        )}
      </div>
    </div>
  );
}
