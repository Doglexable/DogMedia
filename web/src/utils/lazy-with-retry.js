import { lazy } from "react";

export const CHUNK_RELOAD_KEY = "pfs:chunk-reloaded";

function currentBundleId() {
  return typeof document !== "undefined"
    ? document.querySelector('script[type="module"][src]')?.src || "unknown-bundle"
    : "unknown-bundle";
}

export function isChunkLoadError(error) {
  const message = typeof error?.message === "string" ? error.message : String(error || "");
  const name = typeof error?.name === "string" ? error.name : "";
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Unable to preload CSS") ||
    name === "ChunkLoadError"
  );
}

export function reloadForChunkError(error) {
  if (!isChunkLoadError(error) || typeof window === "undefined") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const bundleId = currentBundleId();
    const storage = window.sessionStorage;
    if (!storage || storage.getItem(CHUNK_RELOAD_KEY) === bundleId) return false;
    storage.setItem(CHUNK_RELOAD_KEY, bundleId);
    window.location.reload();
    return true;
  } catch {
    // Without a durable marker, reloading could loop forever.
    return false;
  }
}

/** Reload at most once for a stale bundle; never reload for an offline chunk. */
export async function retryDynamicImport(importer) {
  try {
    return await importer();
  } catch (error) {
    if (reloadForChunkError(error)) {
      // Return a promise that never settles so React stays suspended while reloading
      return new Promise(() => {});
    }
    throw error;
  }
}

/**
 * Wraps React.lazy() dynamic imports to catch 404s on stale chunks after deployments
 * and trigger an automatic reload with the fresh bundle.
 */
export function lazyWithRetry(importer) {
  return lazy(() => retryDynamicImport(importer));
}
