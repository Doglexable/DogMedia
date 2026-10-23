import {
  addStoredRecentMediaId,
  getStoredRecentMediaIds,
} from "../components/global-player/player-utils";

export { addStoredRecentMediaId, getStoredRecentMediaIds };

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
  limit = 8,
} = {}) {
  const seen = new Set();
  const orderedMedia = [];

  for (const id of recentIds) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || seen.has(numericId)) continue;
    const item = mediaById.get(numericId);
    if (!item) continue;
    seen.add(numericId);
    orderedMedia.push(item);
    if (orderedMedia.length >= limit) break;
  }

  return orderedMedia;
}
