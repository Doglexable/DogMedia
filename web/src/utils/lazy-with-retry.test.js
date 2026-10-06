import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isChunkLoadError, reloadForChunkError, retryDynamicImport, CHUNK_RELOAD_KEY } from "./lazy-with-retry";

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
    vi.stubGlobal("document", { querySelector: () => ({ src: "/assets/index-1.js" }) });
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("resolves the imported component without clearing the reload guard", async () => {
    const component = { default: () => null };
    const importer = vi.fn().mockResolvedValue(component);
    mockSessionStore.set(CHUNK_RELOAD_KEY, "/assets/index-1.js");

    const result = await retryDynamicImport(importer);
    expect(result).toBe(component);
    expect(mockSessionStore.get(CHUNK_RELOAD_KEY)).toBe("/assets/index-1.js");
  });

  it("triggers window.location.reload when a chunk error occurs and has not yet reloaded", async () => {
    const chunkError = new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1:8030/assets/Wrapped.js");

    retryDynamicImport(async () => {
      throw chunkError;
    });

    await Promise.resolve();
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(mockSessionStore.get(CHUNK_RELOAD_KEY)).toBe("/assets/index-1.js");
  });

  it("re-throws the error if reload has already been attempted to prevent infinite loops", async () => {
    const chunkError = new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1:8030/assets/Wrapped.js");
    mockSessionStore.set(CHUNK_RELOAD_KEY, "/assets/index-1.js");

    await expect(retryDynamicImport(async () => {
      throw chunkError;
    })).rejects.toThrow("Failed to fetch dynamically imported module");

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("does not reload when offline, even for a failed lazy chunk", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const error = new TypeError("Failed to fetch dynamically imported module");

    await expect(retryDynamicImport(async () => { throw error; })).rejects.toBe(error);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(mockSessionStore.has(CHUNK_RELOAD_KEY)).toBe(false);
  });

  it("does not loop when one chunk loads between two failed chunks", async () => {
    const error = new TypeError("Failed to fetch dynamically imported module");
    expect(reloadForChunkError(error)).toBe(true);
    await retryDynamicImport(async () => ({ default: () => null }));
    await expect(retryDynamicImport(async () => { throw error; })).rejects.toBe(error);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("permits one new reload when the entry bundle changes", () => {
    const error = new TypeError("Failed to fetch dynamically imported module");
    expect(reloadForChunkError(error)).toBe(true);
    vi.stubGlobal("document", { querySelector: () => ({ src: "/assets/index-2.js" }) });
    expect(reloadForChunkError(error)).toBe(true);
    expect(reloadForChunkError(error)).toBe(false);
    expect(reloadMock).toHaveBeenCalledTimes(2);
  });
});
