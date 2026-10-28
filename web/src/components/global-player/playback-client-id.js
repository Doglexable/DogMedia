function generatePlaybackClientId() {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      try {
        return crypto.randomUUID();
      } catch {}
    }
    if (typeof crypto.getRandomValues === "function") {
      try {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      } catch {}
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const STORAGE_KEY = "pfs:playback-client-id";

function readPlaybackClientId() {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (typeof stored === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(stored)) return stored;
  } catch {}
  const generated = generatePlaybackClientId();
  try { window.sessionStorage.setItem(STORAGE_KEY, generated); } catch {}
  return generated;
}

const playbackClientId = typeof window === "undefined" ? generatePlaybackClientId() : readPlaybackClientId();

export function getPlaybackClientId() {
  return playbackClientId;
}

export { generatePlaybackClientId };
