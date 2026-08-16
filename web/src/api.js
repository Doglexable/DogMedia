// Base URL from env (empty string = same origin / Vite proxy in dev)
const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

export function api(path, options = {}) {
  return fetch(apiUrl(path), { ...options, credentials: "include" });
}
