import { beforeEach, describe, expect, it, vi } from "vitest";
import { isChunkLoadError, retryDynamicImport, CHUNK_RELOAD_KEY } from "./lazy-with-retry";

describe("isChunkLoadError", () => {
  it("detects dynamic import module fetch failure", () => {
    const error = new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1:8030/assets/Wrapped-PvcBfXNr.js");
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("detects Safari / WebKit module script import error", () => {
    const error = new TypeError("Importing a module script failed.");
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("detects Firefox dynamic import error", () => {
    const error = new TypeError("error loading dynamically imported module: http://127.0.0.1:8030/assets/Wrapped.js");
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("detects ChunkLoadError by name", () => {
    const error = new Error("Loading chunk 5 failed");
    error.name = "ChunkLoadError";
    expect(isChunkLoadError(error)).toBe(true);
  });

  it("returns false for regular application errors", () => {
    expect(isChunkLoadError(new Error("Network connection lost"))).toBe(false);
    expect(isChunkLoadError(new TypeError("Cannot read property of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("retryDynamicImport", () => {
  let mockSessionStore;
  let reloadMock;

  beforeEach(() => {
    mockSessionStore = new Map();
    reloadMock = vi.fn();

    vi.stubGlobal("sessionStorage", {
      getItem: (k) => mockSessionStore.get(k) ?? null,
      setItem: (k, v) => mockSessionStore.set(k, String(v)),
      removeItem: (k) => mockSessionStore.delete(k),
      clear: () => mockSessionStore.clear(),
    });

    vi.stubGlobal("window", {
      location: { reload: reloadMock },
      sessionStorage: {
        getItem: (k) => mockSessionStore.get(k) ?? null,
        setItem: (k, v) => mockSessionStore.set(k, String(v)),
        removeItem: (k) => mockSessionStore.delete(k),
      },
    });
  });

  it("resolves the imported component and clears chunk reload marker on success", async () => {
    const component = { default: () => null };
    const importer = vi.fn().mockResolvedValue(component);
    mockSessionStore.set(CHUNK_RELOAD_KEY, "true");

    const result = await retryDynamicImport(importer);
    expect(result).toBe(component);
    expect(mockSessionStore.get(CHUNK_RELOAD_KEY)).toBeUndefined();
  });

  it("triggers window.location.reload when a chunk error occurs and has not yet reloaded", async () => {
    const chunkError = new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1:8030/assets/Wrapped.js");

    retryDynamicImport(async () => {
      throw chunkError;
    });

    await Promise.resolve();
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(mockSessionStore.get(CHUNK_RELOAD_KEY)).toBe("true");
  });

  it("re-throws the error if reload has already been attempted to prevent infinite loops", async () => {
    const chunkError = new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1:8030/assets/Wrapped.js");
    mockSessionStore.set(CHUNK_RELOAD_KEY, "true");

    await expect(retryDynamicImport(async () => {
      throw chunkError;
    })).rejects.toThrow("Failed to fetch dynamically imported module");

    expect(reloadMock).not.toHaveBeenCalled();
  });
});
