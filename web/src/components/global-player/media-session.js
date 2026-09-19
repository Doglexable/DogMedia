import { getMediaFolder, resolveMediaArtist } from "./player-utils";
import { mediaThumbnailUrl } from "../../api";

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

export function getAudioArtist(mediaOrArtists) {
  if (mediaOrArtists && typeof mediaOrArtists === "object") {
    const resolved = resolveMediaArtist(mediaOrArtists, "");
    return UNKNOWN_ARTIST_LABELS.has(resolved.toLowerCase()) ? "" : resolved;
  }
  const value = cleanMediaText(mediaOrArtists);
  return UNKNOWN_ARTIST_LABELS.has(value.toLowerCase()) ? "" : value;
}

export function getMediaSessionMetadata(media, { isAudio, mediaLabel, origin }) {
  const thumbnailUrl = mediaThumbnailUrl(media);
  const artwork = thumbnailUrl
    ? [{ src: new URL(thumbnailUrl, origin).href }]
    : [];

  const artist = isAudio
    ? (getAudioArtist(media) || getAudioArtist(media?.artists))
    : cleanMediaText(mediaLabel);

  return {
    title: cleanMediaText(media?.title) || "Untitled",
    artist,
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
