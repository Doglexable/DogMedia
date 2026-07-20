import { faFile, faImage, faMusic, faVideo } from "@fortawesome/free-solid-svg-icons";

export const LOOP_MODES = ["none", "queue", "media"];

export function formatDuration(seconds) {
  if (!seconds) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;
}

export function getMediaMeta(mime = "") {
  if (mime.startsWith("video/")) return { icon: faVideo, label: "Video" };
  if (mime.startsWith("audio/")) return { icon: faMusic, label: "Audio" };
  if (mime.startsWith("image/")) return { icon: faImage, label: "Photo" };
  return { icon: faFile, label: "File" };
}

export function getMediaFolder(media) {
  if (media?.category_path) return media.category_path;
  if (media?.category_name) return media.category_name;
  if (media?.file_path?.includes("/")) return media.file_path.split("/").slice(0, -1).join("/");
  return "Library";
}

export function getMediaFolderName(media) {
  const folder = getMediaFolder(media);
  const parts = folder.split("/").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) || folder;
}

export function getCategoryQuery(categoryId) {
  return categoryId ? `?category=${categoryId}` : "";
}

export function getNextLoopMode(mode) {
  const index = LOOP_MODES.indexOf(mode);
  return LOOP_MODES[(index + 1) % LOOP_MODES.length];
}

export function getLoopButtonTitle(mode) {
  if (mode === "queue") return "Loop queue";
  if (mode === "media") return "Loop media";
  return "No loop";
}
