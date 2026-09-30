import { lazy } from "react";

export const CHUNK_RELOAD_KEY = "pfs:chunk-reloaded";

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

/**
 * Executes a dynamic import with automatic page reload when encountering stale chunk 404s.
 */
export async function retryDynamicImport(importer) {
  const hasReloaded = typeof window !== "undefined" && Boolean(window.sessionStorage?.getItem(CHUNK_RELOAD_KEY));
  try {
    const module = await importer();
    if (typeof window !== "undefined") {
      window.sessionStorage?.removeItem(CHUNK_RELOAD_KEY);
    }
    return module;
  } catch (error) {
    if (isChunkLoadError(error) && !hasReloaded && typeof window !== "undefined") {
      window.sessionStorage?.setItem(CHUNK_RELOAD_KEY, "true");
      window.location.reload();
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
