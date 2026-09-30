export function filterDisplayCategories(categories) {
  if (!Array.isArray(categories)) return [];
  const hasCounts = categories.some((c) => typeof c?.media_count === "number");
  if (hasCounts) {
    return categories.filter((c) => Number(c?.media_count) > 0);
  }
  return categories;
}

export function findCategoryById(categories, id) {
  if (!Array.isArray(categories) || id == null) return null;
  return categories.find((c) => String(c?.id) === String(id)) || null;
}

export function toggleCategorySelection(selectedId, targetId) {
  if (targetId == null || String(selectedId) === String(targetId)) {
    return null;
  }
  return targetId;
}

export function getBrowseSectionTitle({ categories, debouncedSearch, mediaCount = 0, selectedId }) {
  if (debouncedSearch) {
    return `Search results (${mediaCount})`;
  }
  if (selectedId != null) {
    const category = findCategoryById(categories, selectedId);
    if (category) {
      return category.path || category.name || "Browse";
    }
  }
  return "Browse";
}
