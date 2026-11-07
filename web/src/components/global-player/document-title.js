import { cleanMediaText, getAudioArtist } from "./media-session";

const APP_TITLE = "Dogmedia";

export function getPlaybackDocumentTitle({
  media,
  isAudio = false,
  playlistSuggestion = null,
  sleepTimerCompleted = false,
  sleepTimerMode = null,
  sleepTimerRemaining = 0,
} = {}) {
  const mediaTitle = cleanMediaText(media?.title);

  if (sleepTimerCompleted) {
    return `! Sleep timer finished${mediaTitle ? ` — ${mediaTitle}` : ""} - ${APP_TITLE}`;
  }

  const nextFolder = cleanMediaText(playlistSuggestion?.category?.name);
  if (nextFolder) {
    const nextMedia = cleanMediaText(playlistSuggestion?.media?.title);
    return `! Next playlist: ${nextFolder}${nextMedia ? ` — ${nextMedia}` : ""} - ${APP_TITLE}`;
  }

  const artist = isAudio ? getAudioArtist(media) : "";
  const mediaLabel = mediaTitle
    ? `${mediaTitle}${artist ? ` by ${artist}` : ""} - ${APP_TITLE}`
    : APP_TITLE;

  if (sleepTimerMode === "media") return `Sleep timer: after this media · ${mediaLabel}`;
  if (sleepTimerMode === "playlist") return `Sleep timer: after this playlist · ${mediaLabel}`;
  if (sleepTimerMode === "duration") {
    const minutes = Math.max(1, Math.ceil(sleepTimerRemaining / 60));
    return `Sleep timer: ${minutes} min left · ${mediaLabel}`;
  }

  return mediaLabel;
}
