import { describe, expect, it, vi } from "vitest";
import {
  DownloadCancelledError,
  createDownloadLifecycleManager,
  finalizeDownloadAttempt,
} from "./download-lifecycle";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("download lifecycle & finalization", () => {
  it("(a) cancels after bytes finish but before artwork resolves", async () => {
    const lifecycle = createDownloadLifecycleManager();
    const mediaId = 101;
    const attemptToken = "token-attempt-a";
    lifecycle.startAttempt(mediaId, attemptToken);

    const artworkDeferred = deferred();
    const saveDownload = vi.fn();
    const storage = new Map();

    const finalization = finalizeDownloadAttempt({
      lifecycle,
      mediaId,
      attemptToken,
      fetchArtwork: () => artworkDeferred.promise,
      fetchLyrics: () => Promise.resolve({ lines: [] }),
      saveDownload: async (data) => {
        saveDownload(data);
        storage.set(mediaId, { fileUri: `audio/101-v1-${attemptToken}.m4a` });
      },
      getStoredDownload: async (id) => storage.get(id),
      deleteStoredDownload: async (id) => storage.delete(id),
    });

    // Cancel while artwork is pending
    lifecycle.cancelAttempt(mediaId);

    // Artwork resolves late
    artworkDeferred.resolve("thumb/101.jpg");

    await expect(finalization).rejects.toThrow(DownloadCancelledError);
    expect(saveDownload).not.toHaveBeenCalled();
    expect(storage.has(mediaId)).toBe(false);
  });

  it("(b) Remove all (invalidateAll) cancels while lyrics resolve", async () => {
    const lifecycle = createDownloadLifecycleManager();
    const mediaId = 102;
    const attemptToken = "token-attempt-b";
    lifecycle.startAttempt(mediaId, attemptToken);

    const lyricsDeferred = deferred();
    const saveDownload = vi.fn();
    const storage = new Map();

    const finalization = finalizeDownloadAttempt({
      lifecycle,
      mediaId,
      attemptToken,
      fetchArtwork: () => Promise.resolve("thumb/102.jpg"),
      fetchLyrics: () => lyricsDeferred.promise,
      saveDownload: async (data) => {
        saveDownload(data);
        storage.set(mediaId, { fileUri: `audio/102-v1-${attemptToken}.m4a` });
      },
      getStoredDownload: async (id) => storage.get(id),
      deleteStoredDownload: async (id) => storage.delete(id),
    });

    // Invalidate all downloads (e.g. Remove all or Account Clear)
    lifecycle.invalidateAll();

    // Lyrics resolve late
    lyricsDeferred.resolve({ lines: ["Hello world"] });

    await expect(finalization).rejects.toThrow(DownloadCancelledError);
    expect(saveDownload).not.toHaveBeenCalled();
    expect(storage.has(mediaId)).toBe(false);
  });

  it("(c) removes stored row if cancelled while save promise is in flight", async () => {
    const lifecycle = createDownloadLifecycleManager();
    const mediaId = 103;
    const attemptToken = "token-attempt-c";
    lifecycle.startAttempt(mediaId, attemptToken);

    const saveDeferred = deferred();
    const storage = new Map();

    const finalization = finalizeDownloadAttempt({
      lifecycle,
      mediaId,
      attemptToken,
      fetchArtwork: () => Promise.resolve("thumb/103.jpg"),
      fetchLyrics: () => Promise.resolve({ lines: [] }),
      saveDownload: async () => {
        // Simulating write starting in database
        storage.set(mediaId, { fileUri: `audio/103-v1-${attemptToken}.m4a` });
        await saveDeferred.promise;
      },
      getStoredDownload: async (id) => storage.get(id),
      deleteStoredDownload: async (id) => storage.delete(id),
    });

    // Cancel while save is in flight
    lifecycle.cancelAttempt(mediaId);

    // Save promise finishes
    saveDeferred.resolve();

    await expect(finalization).rejects.toThrow(DownloadCancelledError);
    // Post-save guard must have detected cancellation and cleaned up the newly saved row
    expect(storage.has(mediaId)).toBe(false);
  });

  it("(d) retry starts a new token and succeeds; old cancelled attempt cannot delete new retry data", async () => {
    const lifecycle = createDownloadLifecycleManager();
    const mediaId = 104;

    const tokenA = "token-attempt-old";
    lifecycle.startAttempt(mediaId, tokenA);

    const lyricsDeferredA = deferred();
    const storage = new Map();

    const finalizationA = finalizeDownloadAttempt({
      lifecycle,
      mediaId,
      attemptToken: tokenA,
      fetchArtwork: () => Promise.resolve("thumb/104-old.jpg"),
      fetchLyrics: () => lyricsDeferredA.promise,
      saveDownload: async () => {
        storage.set(mediaId, { fileUri: `audio/104-v1-${tokenA}.m4a` });
      },
      getStoredDownload: async (id) => storage.get(id),
      deleteStoredDownload: async (id) => storage.delete(id),
    });

    // User cancels attempt A
    lifecycle.cancelAttempt(mediaId);

    // User triggers retry -> attempt B starts with a new token
    const tokenB = "token-attempt-retry";
    lifecycle.startAttempt(mediaId, tokenB);

    // Attempt B proceeds and completes immediately
    await finalizeDownloadAttempt({
      lifecycle,
      mediaId,
      attemptToken: tokenB,
      fetchArtwork: () => Promise.resolve("thumb/104-retry.jpg"),
      fetchLyrics: () => Promise.resolve({ lines: ["New lyrics"] }),
      saveDownload: async () => {
        storage.set(mediaId, { fileUri: `audio/104-v1-${tokenB}.m4a`, version: "retry" });
      },
      getStoredDownload: async (id) => storage.get(id),
      deleteStoredDownload: async (id) => storage.delete(id),
    });

    // Verify retry data is persisted
    expect(storage.get(mediaId)).toEqual({
      fileUri: `audio/104-v1-${tokenB}.m4a`,
      version: "retry",
    });

    // Now old attempt A finishes lyrics late
    lyricsDeferredA.resolve({ lines: ["Old lyrics"] });

    await expect(finalizationA).rejects.toThrow(DownloadCancelledError);

    // Attempt B's data MUST remain untouched!
    expect(storage.get(mediaId)).toEqual({
      fileUri: `audio/104-v1-${tokenB}.m4a`,
      version: "retry",
    });
  });

  it("handles finishAttempt safely without clearing newer attempts", () => {
    const lifecycle = createDownloadLifecycleManager();
    const mediaId = 105;

    lifecycle.startAttempt(mediaId, "token-1");
    expect(lifecycle.isCurrent(mediaId, "token-1")).toBe(true);

    // Token 2 replaces Token 1
    lifecycle.startAttempt(mediaId, "token-2");
    expect(lifecycle.isCurrent(mediaId, "token-2")).toBe(true);
    expect(lifecycle.isCurrent(mediaId, "token-1")).toBe(false);

    // Token 1 finishes late
    lifecycle.finishAttempt(mediaId, "token-1");
    // Token 2 must still be current!
    expect(lifecycle.isCurrent(mediaId, "token-2")).toBe(true);
  });
});
