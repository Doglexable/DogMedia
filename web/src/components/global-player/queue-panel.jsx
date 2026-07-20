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

export function QueuePanel({ currentMedia, items, loading, total, onClear, onClose, onRemove, onReorder, onSelect }) {
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

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    if (Number(active.id) === Number(currentMedia?.id)) return;
    const oldIndex = items.findIndex((item) => Number(item.id) === Number(active.id));
    const newIndex = items.findIndex((item) => Number(item.id) === Number(over.id));
    run(onReorder(arrayMove(items, oldIndex, newIndex).map((item) => Number(item.id))));
  };

  return (
    <div className="premium-queue-panel" style={styles.queuePanel}>
      <div style={styles.queueHeader}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>Queue</div>
          <div style={{ marginTop: 2, fontSize: 12, color: "var(--muted)" }}>
            {total ? `${total} item${total === 1 ? "" : "s"} queued` : "No items queued"}
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((item) => Number(item.id))} strategy={verticalListSortingStrategy}>
              {items.map((item, index) => (
                <SortableQueueItem
                  key={item.id}
                  active={Number(item.id) === Number(currentMedia?.id)}
                  index={index}
                  item={item}
                  onRemove={(id) => run(onRemove(id))}
                  onSelect={onSelect}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>Queue is empty.</div>
        )}
      </div>
    </div>
  );
}
