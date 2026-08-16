export const OFFLINE_LEASE_DAYS = 30;
export const OFFLINE_MAX_CONCURRENT_DOWNLOADS = 2;
export const OFFLINE_DISK_RESERVE_BYTES = 50 * 1024 * 1024;

export function evaluateOfflineLease(lease, now = Date.now()) {
  if (lease?.locked) return { playable: false, state: "locked" };
  const expiresAt = new Date(lease?.expiresAt || 0).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return { playable: false, state: "expired" };
  return { playable: true, state: "valid", expiresAt: new Date(expiresAt).toISOString() };
}

export function getDownloadNetworkPolicy({ isConnected, type, cellularApproved = false }) {
  if (!isConnected) return "offline";
  if (type === "cellular" && !cellularApproved) return "cellular-approval";
  return "allowed";
}

export function hasDownloadDiskSpace(freeBytes, expectedBytes, reserveBytes = OFFLINE_DISK_RESERVE_BYTES) {
  return Number(freeBytes) >= Number(expectedBytes) + reserveBytes;
}

export function filterPlayableOfflineQueue(items, validIds) {
  const allowed = validIds instanceof Set ? validIds : new Set(validIds || []);
  return (items || []).filter((item) => allowed.has(Number(item?.id)));
}

export function resolveOfflineSource(mediaId, downloads, lease) {
  if (!evaluateOfflineLease(lease).playable) return null;
  const item = downloads instanceof Map ? downloads.get(Number(mediaId)) : downloads?.[Number(mediaId)];
  return item?.status === "ready" && item?.fileUri ? item.fileUri : null;
}

export function shouldReplaceResume(local, remote) {
  return new Date(local?.updatedAt || 0).getTime() > new Date(remote?.updatedAt || 0).getTime();
}

export function nextDownloadState(current, event) {
  const transitions = {
    queued: { start: "downloading", cancel: "cancelled", pause: "paused" },
    downloading: { finish: "ready", fail: "failed", cancel: "cancelled", pause: "paused" },
    paused: { retry: "queued", cancel: "cancelled" },
    failed: { retry: "queued", cancel: "cancelled" },
  };
  return transitions[current]?.[event] || current;
}
