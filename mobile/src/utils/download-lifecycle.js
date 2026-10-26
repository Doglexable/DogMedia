export class DownloadCancelledError extends Error {
  constructor(message = "Download cancelled") {
    super(message);
    this.name = "DownloadCancelledError";
  }
}

/**
 * Manages unique download attempt tokens per media ID, ensuring that cancelled attempts
 * cannot finalize files or persist ready records, and that old cancellations do not affect retries.
 */
export function createDownloadLifecycleManager() {
  const activeAttempts = new Map(); // mediaId (number) -> token (string)
  const cancelledTokens = new Set(); // token (string)

  return {
    startAttempt(mediaId, token) {
      const id = Number(mediaId);
      if (!token) {
        throw new Error("Attempt token is required");
      }
      activeAttempts.set(id, token);
      return token;
    },

    cancelAttempt(mediaId) {
      const id = Number(mediaId);
      const token = activeAttempts.get(id);
      if (token) {
        cancelledTokens.add(token);
        activeAttempts.delete(id);
        return token;
      }
      return null;
    },

    invalidateAll() {
      for (const token of activeAttempts.values()) {
        cancelledTokens.add(token);
      }
      activeAttempts.clear();
    },

    isCurrent(mediaId, token) {
      const id = Number(mediaId);
      if (!token || cancelledTokens.has(token)) return false;
      return activeAttempts.get(id) === token;
    },

    isCancelled(token) {
      return !token || cancelledTokens.has(token);
    },

    finishAttempt(mediaId, token) {
      const id = Number(mediaId);
      if (activeAttempts.get(id) === token) {
        activeAttempts.delete(id);
      }
    },

    assertCurrent(mediaId, token) {
      if (!this.isCurrent(mediaId, token)) {
        throw new DownloadCancelledError();
      }
    },
  };
}

/**
 * Wraps asynchronous post-byte operations (artwork, lyrics, and persistence)
 * with strict attempt ownership checks at each stage.
 */
export async function finalizeDownloadAttempt({
  lifecycle,
  mediaId,
  attemptToken,
  fetchArtwork,
  fetchLyrics,
  saveDownload,
  getStoredDownload,
  deleteStoredDownload,
}) {
  lifecycle.assertCurrent(mediaId, attemptToken);

  let artworkUri = null;
  if (fetchArtwork) {
    artworkUri = await fetchArtwork();
    lifecycle.assertCurrent(mediaId, attemptToken);
  }

  let lyrics = null;
  if (fetchLyrics) {
    lyrics = await fetchLyrics();
    lifecycle.assertCurrent(mediaId, attemptToken);
  }

  lifecycle.assertCurrent(mediaId, attemptToken);

  await saveDownload({ artworkUri, lyrics });

  // Guard against cancellation occurring while saveDownload was in flight
  if (!lifecycle.isCurrent(mediaId, attemptToken)) {
    if (getStoredDownload && deleteStoredDownload) {
      const stored = await getStoredDownload(mediaId);
      if (stored?.fileUri && stored.fileUri.includes(attemptToken)) {
        await deleteStoredDownload(mediaId);
      }
    }
    throw new DownloadCancelledError();
  }
}
