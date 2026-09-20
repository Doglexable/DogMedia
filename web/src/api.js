// Base URL from env (empty string = same origin / Vite proxy in dev)
const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

export function mediaThumbnailUrl(mediaOrId) {
  const isMedia = mediaOrId !== null && typeof mediaOrId === "object";
  const mediaId = Number(isMedia ? (mediaOrId.id ?? mediaOrId.mediaId) : mediaOrId);
  if (!Number.isFinite(mediaId) || mediaId <= 0) return "";
  const version = isMedia ? mediaOrId.artwork_version : null;
  const query = version ? `?v=${encodeURIComponent(version)}` : "";
  return apiUrl(`/api/media/${mediaId}/thumbnail${query}`);
}

export function categoryThumbnailUrl(categoryOrId) {
  const isCategory = categoryOrId !== null && typeof categoryOrId === "object";
  const categoryId = Number(isCategory ? categoryOrId.id : categoryOrId);
  if (!Number.isFinite(categoryId) || categoryId <= 0) return "";
  const coverPath = isCategory ? categoryOrId.cover_path : null;
  const query = coverPath ? `?v=${encodeURIComponent(coverPath)}` : "";
  return apiUrl(`/api/categories/${categoryId}/thumbnail${query}`);
}

export function api(path, options = {}) {
  return fetch(apiUrl(path), { ...options, credentials: "include" });
}

export async function createPlaybackSession(mediaId, quality = "high", { signal } = {}) {
  const response = await api(`/api/media/${Number(mediaId)}/playback-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quality }),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.streamUrl) {
    const error = new Error(data?.error || "Could not create a protected playback session");
    error.code = data?.code;
    error.retryAfter = data?.retryAfter;
    throw error;
  }
  return data;
}

export async function heartbeatPlaybackLease(sessionId) {
  const response = await api("/api/playback/lease/heartbeat", {
    method: "POST",
    headers: { "X-Playback-Session": sessionId },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || "Playback lease could not be renewed");
    error.code = data?.code;
    error.retryAfter = data?.retryAfter;
    throw error;
  }
  return data;
}

export async function releasePlaybackLease(sessionId) {
  if (!sessionId) return;
  await api("/api/playback/lease", {
    method: "DELETE",
    headers: { "X-Playback-Session": sessionId },
    keepalive: true,
  }).catch(() => {});
}

export async function readJsonArray(response, fallbackMessage = "Request failed") {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || fallbackMessage);
  if (!Array.isArray(data)) throw new TypeError(`${fallbackMessage}: expected an array response`);
  return data;
}
