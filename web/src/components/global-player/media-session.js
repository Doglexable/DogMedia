import { getMediaFolder } from "./player-utils";

const UNKNOWN_ARTIST_LABELS = new Set(["unknown", "unknown artist"]);

export const MEDIA_SESSION_ACTIONS = [
  "play",
  "pause",
  "stop",
  "seekbackward",
  "seekforward",
  "seekto",
  "previoustrack",
  "nexttrack",
];

export function cleanMediaText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getAudioArtist(artists) {
  const value = cleanMediaText(artists);
  return UNKNOWN_ARTIST_LABELS.has(value.toLowerCase()) ? "" : value;
}

export function getMediaSessionMetadata(media, { isAudio, mediaLabel, origin }) {
  const mediaId = Number(media?.id);
  const artwork = Number.isFinite(mediaId) && mediaId > 0
    ? [{ src: new URL(`/api/media/${mediaId}/thumbnail`, origin).href }]
    : [];

  return {
    title: cleanMediaText(media?.title) || "Untitled",
    artist: isAudio ? getAudioArtist(media?.artists) : cleanMediaText(mediaLabel),
    album: getMediaFolder(media) || "Library",
    artwork,
  };
}

function setActionHandler(mediaSession, action, handler) {
  try {
    mediaSession.setActionHandler(action, handler);
  } catch {
    // Some browsers expose Media Session but not every action.
  }
}

export function registerMediaSessionActionHandlers(
  mediaSession,
  handlersRef,
  { canGoPrev, canGoNext }
) {
  const invoke = (action) => (details) => handlersRef.current?.[action]?.(details);

  setActionHandler(mediaSession, "play", invoke("play"));
  setActionHandler(mediaSession, "pause", invoke("pause"));
  setActionHandler(mediaSession, "stop", invoke("stop"));
  setActionHandler(mediaSession, "seekbackward", invoke("seekbackward"));
  setActionHandler(mediaSession, "seekforward", invoke("seekforward"));
  setActionHandler(mediaSession, "seekto", invoke("seekto"));
  setActionHandler(mediaSession, "previoustrack", canGoPrev ? invoke("previoustrack") : null);
  setActionHandler(mediaSession, "nexttrack", canGoNext ? invoke("nexttrack") : null);

  return () => {
    MEDIA_SESSION_ACTIONS.forEach((action) => setActionHandler(mediaSession, action, null));
  };
}
