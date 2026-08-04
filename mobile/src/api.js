const envApiBase = process.env.EXPO_PUBLIC_API_URL?.trim();

export const API_BASE = (envApiBase || "http://localhost:3001").replace(/\/+$/, "");

function absoluteApiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function mediaThumbnailUrl(mediaId) {
  return absoluteApiUrl(`/api/media/${mediaId}/thumbnail`);
}

export function mediaStreamUrl(mediaId) {
  return absoluteApiUrl(`/api/media/${mediaId}/stream`);
}

export async function api(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
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
