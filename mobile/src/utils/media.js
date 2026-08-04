export const LOOP_MODES = ["none", "queue", "media"];

export function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function getMediaKind(mime = "") {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return "file";
}

export function getMediaLabel(mime = "") {
  const kind = getMediaKind(mime);
  if (kind === "audio") return "Audio";
  if (kind === "video") return "Video";
  if (kind === "image") return "Photo";
  return "File";
}

export function getArtistLabel(artists) {
  return typeof artists === "string" && artists.trim() ? artists.trim() : "Unknown artist";
}

export function getMediaFolderName(media) {
  return media?.category_path || media?.category_name || "Library";
}

export function nextLoopMode(mode) {
  const index = LOOP_MODES.indexOf(mode);
  return LOOP_MODES[(index + 1) % LOOP_MODES.length];
}
