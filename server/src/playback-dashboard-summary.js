function orderedIds(items, filter = () => true, sorter = null, limit = 14) {
  const source = items.filter(filter);
  if (sorter) source.sort(sorter);
  return source.slice(0, limit).map((item) => item.id);
}

function idsByPlaybackScore(items, filter = () => true, limit = 14) {
  return orderedIds(
    items,
    filter,
    (a, b) =>
      b.playbackScore - a.playbackScore ||
      b.totalTime - a.totalTime ||
      b.playCount - a.playCount ||
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0) ||
      a.title.localeCompare(b.title),
    limit
  );
}

function idsByRecentPlayback(items, filter = () => true, limit = 14) {
  return orderedIds(
    items,
    (item) => filter(item) && item.lastPlayedAt,
    (a, b) =>
      new Date(b.lastPlayedAt || 0) - new Date(a.lastPlayedAt || 0) ||
      b.playbackScore - a.playbackScore ||
      a.title.localeCompare(b.title),
    limit
  );
}

function fallbackIds(items, filter = () => true, limit = 14) {
  return orderedIds(
    items,
    filter,
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0) || a.title.localeCompare(b.title),
    limit
  );
}

function withFallback(primaryIds, fallbackIdList, limit = 14) {
  const seen = new Set();
  const ids = [];

  for (const id of [...primaryIds, ...fallbackIdList]) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || seen.has(numericId)) continue;
    seen.add(numericId);
    ids.push(numericId);
    if (ids.length >= limit) break;
  }

  return ids;
}

export function buildDashboardSummary(items, options = {}) {
  const hasPlayback = items.some((item) => item.playCount > 0 || item.totalTime > 0 || item.lastPlayedAt);
  const lastPlayedAt = items
    .map((item) => item.lastPlayedAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;
  const allFallback = fallbackIds(items, () => true, 24);
  const playedIds = hasPlayback ? idsByPlaybackScore(items, () => true, 24) : [];
  const recentIds = hasPlayback ? idsByRecentPlayback(items, () => true, 24) : [];

  const featuredId = withFallback(playedIds, allFallback, 1)[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    refreshIntervalSeconds: options.refreshIntervalSeconds,
    source: hasPlayback ? "playback_events" : "media_assets",
    filters: {
      view: options.view || "all",
      categoryId: options.categoryId || null,
    },
    stats: {
      totalPlayTime: items.reduce((sum, item) => sum + Math.max(0, Number(item.totalTime) || 0), 0),
      totalPlays: items.reduce((sum, item) => sum + Math.max(0, Number(item.playCount) || 0), 0),
      activeMediaCount: items.filter((item) => item.playCount > 0 || item.totalTime > 0 || item.lastPlayedAt).length,
      mediaCount: items.length,
      lastPlayedAt,
    },
    featuredId,
    quickAccessIds: withFallback(recentIds, withFallback(playedIds, allFallback, 24), 8),
    rows: [
      {
        key: "recently-played",
        title: "Recently played",
        type: "square",
        mediaIds: withFallback(recentIds, allFallback, 14),
      },
      {
        key: "top-media",
        title: "Most played",
        type: "square",
        mediaIds: withFallback(playedIds, allFallback, 14),
      },
    ],
  };
}
