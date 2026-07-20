import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronRight,
  faFolder,
  faFolderOpen,
  faFolderPlus,
  faGripVertical,
  faPhotoFilm,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";

function ordered(items) {
  return [...items].sort((a, b) =>
    Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
    a.name.localeCompare(b.name) ||
    Number(a.id) - Number(b.id)
  );
}

function buildTree(categories) {
  const childrenByParent = new Map();
  for (const category of categories) {
    const key = category.parent_id == null ? null : Number(category.parent_id);
    const children = childrenByParent.get(key) || [];
    children.push(category);
    childrenByParent.set(key, children);
  }
  for (const [key, children] of childrenByParent) childrenByParent.set(key, ordered(children));
  return childrenByParent;
}

function DropEdge({ category, edge, activeId }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `${edge}:${category.id}`,
    data: { category, edge },
    disabled: activeId == null || Number(activeId) === Number(category.id),
  });

  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-x-2 ${edge === "before" ? "top-0" : "bottom-0"} z-10 h-2 rounded-full ${isOver ? "bg-primary" : "bg-transparent"}`}
    />
  );
}

function TreeRow({
  activeId, category, depth, expanded, hasChildren, onAddChild, onDelete,
  onManageMedia, onSelect, onToggle, selected, saving,
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: Number(category.id),
    data: { category },
    disabled: saving,
  });
  const { isOver, setNodeRef: setInsideRef } = useDroppable({
    id: `inside:${category.id}`,
    data: { category, edge: "inside" },
    disabled: activeId == null || Number(activeId) === Number(category.id),
  });

  return (
    <div ref={setDragRef} className={`relative py-0.5 ${isDragging ? "opacity-35" : "opacity-100"}`}>
      <DropEdge category={category} edge="before" activeId={activeId} />
      <div
        ref={setInsideRef}
        className={`group flex min-h-12 items-center gap-2 rounded-xl border px-2 py-1.5 transition-colors ${
          selected
            ? "border-primary bg-primary/10"
            : isOver
              ? "border-primary bg-primary/15"
              : "border-transparent hover:border-card-border hover:bg-surface"
        }`}
        style={{ marginLeft: Math.min(depth, 6) * 20 }}
        onClick={() => onSelect(category.id)}
      >
        <button
          type="button"
          className="grid h-8 w-7 shrink-0 cursor-grab place-items-center rounded-lg border-0 bg-transparent text-muted hover:bg-card hover:text-content active:cursor-grabbing disabled:cursor-not-allowed"
          aria-label={`Drag ${category.name}`}
          disabled={saving}
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
        >
          <FontAwesomeIcon icon={faGripVertical} />
        </button>
        <button
          type="button"
          aria-label={hasChildren ? `${expanded ? "Collapse" : "Expand"} ${category.name}` : undefined}
          disabled={!hasChildren}
          className="grid h-7 w-6 shrink-0 place-items-center border-0 bg-transparent text-muted disabled:opacity-0"
          onClick={(event) => {
            event.stopPropagation();
            onToggle(category.id);
          }}
        >
          <FontAwesomeIcon icon={faChevronRight} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
        <FontAwesomeIcon icon={hasChildren && expanded ? faFolderOpen : faFolder} className="shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-extrabold text-content" title={category.name}>{category.name}</div>
          <div className="truncate text-xs text-muted" title={category.path}>{category.path || category.name}</div>
        </div>
        <span className="hidden shrink-0 rounded-full border border-card-border bg-card px-2 py-1 text-[10px] font-extrabold text-muted sm:inline">
          Tier {category.min_access_tier}
        </span>
        <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="category-tree-action" title="Manage media" aria-label={`Manage media in ${category.name}`} onClick={() => onManageMedia(category.id)}>
            <FontAwesomeIcon icon={faPhotoFilm} />
          </button>
          <button type="button" className="category-tree-action" title="Add child" aria-label={`Add child to ${category.name}`} onClick={() => onAddChild(category.id)}>
            <FontAwesomeIcon icon={faFolderPlus} />
          </button>
          <button type="button" className="category-tree-action category-tree-action--danger" title={hasChildren ? "Delete child categories first" : "Delete category"} aria-label={`Delete ${category.name}`} disabled={hasChildren} onClick={() => onDelete(category)}>
            <FontAwesomeIcon icon={faTrash} />
          </button>
        </div>
      </div>
      <DropEdge category={category} edge="after" activeId={activeId} />
    </div>
  );
}

function RootDropZone({ active }) {
  const { isOver, setNodeRef } = useDroppable({ id: "root", data: { edge: "root" }, disabled: !active });
  return (
    <div ref={setNodeRef} className={`mb-2 rounded-xl border border-dashed px-3 py-2 text-center text-xs font-bold transition-colors ${active ? (isOver ? "border-primary bg-primary/15 text-primary" : "border-card-border text-muted") : "border-transparent text-muted"}`}>
      {active ? "Drop here to move to root" : "Drag folders to reorder or change their parent"}
    </div>
  );
}

export function CategoryTreeDnd({ categories, moving, onAddChild, onDelete, onManageMedia, onMove, onSelect, selectedId }) {
  const childrenByParent = useMemo(() => buildTree(categories), [categories]);
  const [expanded, setExpanded] = useState(new Set());
  const [activeId, setActiveId] = useState(null);
  const initialized = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    if (initialized.current || categories.length === 0) return;
    initialized.current = true;
    setExpanded(new Set(categories.filter((category) => (childrenByParent.get(Number(category.id)) || []).length > 0).map((category) => Number(category.id))));
  }, [categories, childrenByParent]);

  const descendantsOf = (categoryId) => {
    const descendants = new Set();
    const visit = (parentId) => {
      for (const child of childrenByParent.get(Number(parentId)) || []) {
        descendants.add(Number(child.id));
        visit(child.id);
      }
    };
    visit(categoryId);
    return descendants;
  };

  const handleDragEnd = async ({ active, over }) => {
    setActiveId(null);
    if (!over) return;

    const draggedId = Number(active.id);
    const target = over.data.current;
    let parentId = null;
    let index = 0;

    if (target?.edge === "root") {
      const roots = (childrenByParent.get(null) || []).filter((item) => Number(item.id) !== draggedId);
      index = roots.length;
    } else if (target?.category) {
      const targetCategory = target.category;
      if (target.edge === "inside") {
        parentId = Number(targetCategory.id);
        index = (childrenByParent.get(parentId) || []).filter((item) => Number(item.id) !== draggedId).length;
      } else {
        parentId = targetCategory.parent_id == null ? null : Number(targetCategory.parent_id);
        const siblings = (childrenByParent.get(parentId) || []).filter((item) => Number(item.id) !== draggedId);
        const targetIndex = siblings.findIndex((item) => Number(item.id) === Number(targetCategory.id));
        if (targetIndex < 0) return;
        index = targetIndex + (target.edge === "after" ? 1 : 0);
      }
    } else {
      return;
    }

    if (parentId === draggedId || (parentId !== null && descendantsOf(draggedId).has(parentId))) return;
    const moved = await onMove(draggedId, parentId, index);
    if (moved && parentId !== null) {
      setExpanded((current) => new Set(current).add(parentId));
    }
  };

  const rows = [];
  const walk = (parentId = null, depth = 0) => {
    for (const category of childrenByParent.get(parentId) || []) {
      const children = childrenByParent.get(Number(category.id)) || [];
      const isExpanded = expanded.has(Number(category.id));
      rows.push(
        <TreeRow
          key={category.id}
          activeId={activeId}
          category={category}
          depth={depth}
          expanded={isExpanded}
          hasChildren={children.length > 0}
          selected={String(category.id) === String(selectedId)}
          saving={moving}
          onAddChild={onAddChild}
          onDelete={onDelete}
          onManageMedia={onManageMedia}
          onSelect={onSelect}
          onToggle={(id) => setExpanded((current) => {
            const next = new Set(current);
            const numericId = Number(id);
            if (next.has(numericId)) next.delete(numericId); else next.add(numericId);
            return next;
          })}
        />
      );
      if (children.length > 0 && isExpanded) walk(Number(category.id), depth + 1);
    }
  };
  walk();

  const activeCategory = categories.find((category) => Number(category.id) === Number(activeId));
  const collisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    const edgeCollision = pointerCollisions.find(({ id }) => String(id).startsWith("before:") || String(id).startsWith("after:"));
    if (edgeCollision) return [edgeCollision];
    return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={({ active }) => setActiveId(Number(active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <RootDropZone active={activeId != null} />
      <div className="grid gap-0.5">{rows}</div>
      <DragOverlay>
        {activeCategory ? (
          <div className="flex items-center gap-2 rounded-xl border border-primary bg-card px-4 py-3 text-sm font-extrabold text-content shadow-2xl">
            <FontAwesomeIcon icon={faFolder} className="text-primary" />
            {activeCategory.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
