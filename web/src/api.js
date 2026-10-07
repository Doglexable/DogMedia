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
  // If the media belongs to a category and shares the category cover without its own distinct thumbnail,
  // canonicalize to category thumbnail URL so all tracks in the playlist/album reuse the identical image URL & browser cache!
  if (isMedia && !mediaOrId.thumbnail_path && Number.isFinite(Number(mediaOrId.category_id)) && Number(mediaOrId.category_id) > 0 && version && !version.includes(`/${mediaId}/`)) {
    const query = version ? `?v=${encodeURIComponent(version)}` : "";
    return apiUrl(`/api/categories/${Number(mediaOrId.category_id)}/thumbnail${query}`);
  }
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

import { normalizeHolderSession } from "./components/global-player/exclusive-session";

export function api(path, options = {}) {
  return fetch(apiUrl(path), { ...options, credentials: "include" });
}

export async function requestPlaybackSocketTicket() {
  const response = await api("/api/playback/socket-ticket", {
    method: "POST",
    headers: { "X-Client-Platform": "web", "X-Client-Name": "Dogmedia Web" },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ticket) throw new Error("Could not open playback updates");
  return data.ticket;
}

export function playbackSocketUrl() {
  const url = new URL(apiUrl("/api/playback/socket"), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export async function createPlaybackSession(mediaId, quality = "high", { signal } = {}) {
  const response = await api(`/api/media/${Number(mediaId)}/playback-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Platform": "web",
      "X-Client-Name": "Dogmedia Web",
    },
    body: JSON.stringify({ quality }),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.streamUrl) {
    const error = new Error(data?.error || "Could not create a protected playback session");
    error.code = data?.code;
    error.retryAfter = data?.retryAfter;
    error.activeSession = normalizeHolderSession(data?.activeSession);
    throw error;
  }
  return data;
}

export async function preparePlaybackStream(session, { signal, maxAttempts = 60 } = {}) {
  if (!session?.streamUrl) throw new Error("Playback session has no stream URL");
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await api(session.streamUrl, {
      headers: { Range: "bytes=0-0", "X-Playback-Session": session.sessionId },
      signal,
    });
    if (response.ok) {
      await response.body?.cancel?.();
      return session.streamUrl;
    }
    const data = await response.json().catch(() => null);
    if (![202, 409].includes(response.status) || !data?.statusUrl) {
      const error = new Error(data?.error || "Playback rendition is unavailable");
      error.code = data?.code;
      error.retryAfter = data?.retryAfter;
      throw error;
    }
    const delay = Math.max(250, Number(data.retryAfter || 5) * 1000);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
    });
  }
  throw new Error("Timed out waiting for playback rendition");
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
    error.activeSession = normalizeHolderSession(data?.activeSession);
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

export async function getPlaybackLease() {
  const response = await api("/api/playback/lease");
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Could not read playback session");
  return {
    state: data?.state === "owned" ? "owned" : data?.state === "busy" ? "busy" : "available",
    expiresIn: Number.isInteger(data?.expiresIn) ? data.expiresIn : 0,
    activeSession: normalizeHolderSession(data?.activeSession),
  };
}

export async function forceReleasePlaybackLease() {
  const response = await api("/api/playback/lease/admin", { method: "DELETE" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Could not move playback to this device");
  return data;
}

export async function readJsonArray(response, fallbackMessage = "Request failed") {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || fallbackMessage);
  if (!Array.isArray(data)) throw new TypeError(`${fallbackMessage}: expected an array response`);
  return data;
}
