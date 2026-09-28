import { api } from "../../api";

const lyricsCache = new Map();
const mediaCache = new Map();

/**
 * Fetch synchronized lyrics for a media ID with automatic in-memory caching and request deduplication.
 * @param {number|string} mediaId
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object|null>}
 */
export function fetchLyrics(mediaId, { signal } = {}) {
  const id = Number(mediaId);
  if (!Number.isFinite(id) || id <= 0) return Promise.resolve(null);

  if (lyricsCache.has(id)) {
    const cached = lyricsCache.get(id);
    return cached instanceof Promise ? cached : Promise.resolve(cached);
  }

  const promise = api(`/api/media/${id}/lyrics`, { signal })
    .then(async (response) => {
      if (response.status === 404) {
        lyricsCache.set(id, null);
        return null;
      }
      if (!response.ok) throw new Error("Lyrics unavailable");
      const data = await response.json();
      lyricsCache.set(id, data);
      return data;
    })
    .catch((error) => {
      if (error?.name !== "AbortError") {
        lyricsCache.delete(id);
      }
      return null;
    });

  lyricsCache.set(id, promise);
  return promise;
}

/**
 * Synchronously retrieve cached lyrics if already loaded and resolved.
 * @param {number|string} mediaId
 * @returns {object|null}
 */
export function getCachedLyrics(mediaId) {
  const id = Number(mediaId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const val = lyricsCache.get(id);
  return val && !(val instanceof Promise) ? val : null;
}

/**
 * Check whether lyrics for a media ID have already been fetched and resolved (hit or confirmed miss).
 * @param {number|string} mediaId
 * @returns {boolean}
 */
export function isLyricsLoaded(mediaId) {
  const id = Number(mediaId);
  if (!Number.isFinite(id) || id <= 0) return false;
  return lyricsCache.has(id) && !(lyricsCache.get(id) instanceof Promise);
}

/**
 * Fetch media item details with in-memory caching and request deduplication.
 * @param {number|string} mediaId
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>}
 */
export function fetchMediaItem(mediaId, { signal } = {}) {
  const id = Number(mediaId);
  if (!Number.isFinite(id) || id <= 0) return Promise.reject(new Error("Invalid media ID"));

  if (mediaCache.has(id)) {
    const cached = mediaCache.get(id);
    return cached instanceof Promise ? cached : Promise.resolve(cached);
  }

  const promise = api(`/api/media/${id}`, { signal })
    .then(async (response) => {
      if (!response.ok) throw new Error("Media unavailable");
      const data = await response.json();
      mediaCache.set(id, data);
      return data;
    })
    .catch((error) => {
      if (error?.name !== "AbortError") {
        mediaCache.delete(id);
      }
      throw error;
    });

  mediaCache.set(id, promise);
  return promise;
}

/**
 * Synchronously retrieve cached media item if already loaded.
 * @param {number|string} mediaId
 * @returns {object|null}
 */
export function getCachedMediaItem(mediaId) {
  const id = Number(mediaId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const val = mediaCache.get(id);
  return val && !(val instanceof Promise) ? val : null;
}

/**
 * Clear the in-memory caches (e.g. for testing).
 */
export function clearLyricsCache() {
  lyricsCache.clear();
  mediaCache.clear();
}
