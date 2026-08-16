const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAYBACK_ACTIONS = new Set(["play", "pause", "end", "skip"]);

export function buildOfflineFileVersion(stats) {
  return `${Number(stats.size)}:${Math.floor(Number(stats.mtimeMs))}`;
}

export function normalizeOfflineMediaId(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeOfflineEvent(value) {
  const mediaId = normalizeOfflineMediaId(value?.mediaId);
  const action = typeof value?.action === "string" ? value.action : "";
  const occurredAt = new Date(value?.occurredAt);
  if (!UUID_PATTERN.test(value?.clientEventId || "") || !mediaId || !PLAYBACK_ACTIONS.has(action) || Number.isNaN(occurredAt.getTime())) {
    return null;
  }

  return {
    clientEventId: value.clientEventId,
    mediaId,
    action,
    position: Math.max(0, Math.floor(Number(value.position) || 0)),
    duration: Math.max(0, Math.floor(Number(value.duration) || 0)),
    title: typeof value.title === "string" ? value.title.slice(0, 255) : null,
    occurredAt: occurredAt.toISOString(),
  };
}

export function normalizeOfflineResume(value) {
  const mediaId = normalizeOfflineMediaId(value?.mediaId);
  const updatedAt = new Date(value?.updatedAt);
  if (!mediaId || Number.isNaN(updatedAt.getTime())) return null;
  return {
    mediaId,
    position: Math.max(0, Math.floor(Number(value.position) || 0)),
    duration: Math.max(0, Math.floor(Number(value.duration) || 0)),
    updatedAt: updatedAt.toISOString(),
  };
}

export function isNewerOfflineResume(localTimestamp, remoteTimestamp) {
  const local = new Date(localTimestamp).getTime();
  const remote = new Date(remoteTimestamp || 0).getTime();
  return Number.isFinite(local) && (!Number.isFinite(remote) || local > remote);
}
