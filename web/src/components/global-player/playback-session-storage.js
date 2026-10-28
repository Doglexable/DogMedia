const STORAGE_KEY = "pfs:playback-session";
const SESSION_ID_RE = /^[A-Za-z0-9_-]{20,128}$/;

export function readStoredPlaybackSession(accountId, mediaId, quality) {
  const stored = getStoredPlaybackSession();
  return stored?.accountId === Number(accountId)
    && stored.mediaId === Number(mediaId)
    && stored.quality === quality ? stored.sessionId : null;
}

export function getStoredPlaybackSession() {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "null");
    if (Number.isSafeInteger(stored?.accountId) && stored.accountId > 0
      && Number.isSafeInteger(stored?.mediaId) && stored.mediaId > 0
      && ["low", "med", "high", "ori"].includes(stored.quality)
      && SESSION_ID_RE.test(stored.sessionId)) return stored;
  } catch {}
  return null;
}

export function storePlaybackSession(accountId, mediaId, quality, sessionId) {
  if (!Number.isSafeInteger(Number(accountId)) || Number(accountId) < 1
    || !Number.isSafeInteger(Number(mediaId)) || Number(mediaId) < 1
    || !["low", "med", "high", "ori"].includes(quality) || !SESSION_ID_RE.test(sessionId)) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      accountId: Number(accountId), mediaId: Number(mediaId), quality, sessionId,
    }));
  } catch {}
}

export function clearStoredPlaybackSession(sessionId = null) {
  try {
    if (sessionId) {
      const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "null");
      if (stored?.sessionId !== sessionId) return;
    }
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}
