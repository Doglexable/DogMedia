import { createApiUnreachableError } from "./utils/playback-errors";
import * as SecureStore from "expo-secure-store";

const envApiBase = process.env.EXPO_PUBLIC_API_URL?.trim();
export const API_REACHABILITY_TIMEOUT_MS = 2500;
const VIEWER_ID_STORAGE_KEY = "pfs:viewer-id";
let cachedViewerId;

async function getViewerId() {
  if (cachedViewerId !== undefined) return cachedViewerId;
  cachedViewerId = await SecureStore.getItemAsync(VIEWER_ID_STORAGE_KEY);
  return cachedViewerId;
}

async function storeViewerId(viewerId) {
  cachedViewerId = viewerId;
  await SecureStore.setItemAsync(VIEWER_ID_STORAGE_KEY, viewerId);
}

export const API_BASE = (envApiBase || "http://localhost:3001").replace(/\/+$/, "");

function absoluteApiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function mediaThumbnailUrl(mediaId) {
  return absoluteApiUrl(`/api/media/${mediaId}/thumbnail`);
}

export function mediaStreamUrl(mediaId, quality = "high") {
  return absoluteApiUrl(`/api/media/${mediaId}/stream?quality=${encodeURIComponent(quality)}`);
}

export async function createPlaybackSessionSource(mediaId, quality = "high") {
  const storedViewerId = await getViewerId();
  const data = await apiJson(`/api/media/${Number(mediaId)}/playback-session`, {
    method: "POST",
    headers: storedViewerId ? { "X-Viewer-ID": storedViewerId } : {},
    body: JSON.stringify({ quality }),
  });
  if (!data?.streamUrl || !data?.sessionId) {
    throw new Error("Could not create a protected playback session");
  }
  if (data.viewerId && data.viewerId !== storedViewerId) {
    await storeViewerId(data.viewerId);
  }
  return {
    uri: absoluteApiUrl(data.streamUrl),
    headers: {
      "X-Playback-Session": data.sessionId,
      "X-Viewer-ID": data.viewerId,
    },
    sessionId: data.sessionId,
    viewerId: data.viewerId,
    leaseRequired: Boolean(data.leaseRequired),
  };
}

export async function heartbeatPlaybackLease(source) {
  if (!source?.leaseRequired) return { ok: true, bypassed: true };
  return apiJson("/api/playback/lease/heartbeat", {
    method: "POST",
    headers: {
      "X-Playback-Session": source.sessionId,
      "X-Viewer-ID": source.viewerId,
    },
  });
}

export async function releasePlaybackLease(source) {
  if (!source?.sessionId) return;
  await api("/api/playback/lease", {
    method: "DELETE",
    headers: {
      "X-Playback-Session": source.sessionId,
      "X-Viewer-ID": source.viewerId,
    },
  }).catch(() => {});
}

export async function api(path, options = {}) {
  const storedViewerId = await getViewerId();
  const headers = {
    Accept: "application/json",
    ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(storedViewerId ? { "X-Viewer-ID": storedViewerId } : {}),
    ...options.headers,
  };

  return fetch(absoluteApiUrl(path), {
    ...options,
    headers,
  });
}

export async function readJson(response, fallbackMessage = "Request failed") {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || fallbackMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export function apiJson(path, options = {}) {
  return api(path, options).then((response) => readJson(response));
}

export async function assertApiReachable({ timeoutMs = API_REACHABILITY_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await api("/api/check-access", { signal: controller.signal });
    return true;
  } catch {
    throw createApiUnreachableError();
  } finally {
    clearTimeout(timeout);
  }
}
