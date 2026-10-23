export function shouldShowBrowse({ hasSearch = false, mediaCount = 0 } = {}) {
  return Boolean(hasSearch) || Number(mediaCount) > 0;
}

export function getGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function buildQuickAccessItems({
  recentIds = [],
  mediaById = new Map(),
  fallbackMedia = [],
  limit = 8,
} = {}) {
  const seen = new Set();
  const orderedMedia = [];

  for (const id of recentIds) {
    const item = mediaById.get(Number(id));
    if (!item || seen.has(Number(item.id))) continue;
    seen.add(Number(item.id));
    orderedMedia.push(item);
    if (orderedMedia.length >= limit - 1) break;
  }

  for (const item of fallbackMedia) {
    if (!item || seen.has(Number(item.id))) continue;
    seen.add(Number(item.id));
    orderedMedia.push(item);
    if (orderedMedia.length >= limit - 1) break;
  }

  if (orderedMedia.length === 0) return [];

  const likedTile = {
    isLikedTile: true,
    id: "liked-songs",
    title: "Liked Songs",
  };

  const result = [...orderedMedia];
  if (result.length >= 1) {
    result.splice(1, 0, likedTile);
  } else {
    result.push(likedTile);
  }

  return result.slice(0, limit);
}
