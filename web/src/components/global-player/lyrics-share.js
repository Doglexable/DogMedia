import { resolveMediaArtist } from "./player-utils";

export const MAX_SHARED_LYRICS = 5;
export const LYRICS_CARD = Object.freeze({ cssWidth: 360, cssHeight: 640, pixelRatio: 3 });

export function createLyricsSelection(index, segmentCount) {
  if (!Number.isInteger(index) || index < 0 || index >= segmentCount) return null;
  return { start: index, end: index };
}

export function updateLyricsSelection(selection, index, segmentCount, maxLines = MAX_SHARED_LYRICS) {
  if (!Number.isInteger(index) || index < 0 || index >= segmentCount) return selection;
  if (!selection) return createLyricsSelection(index, segmentCount);

  const { start, end } = selection;
  if (index === start && index === end) return null;
  if (index === start) return { start: start + 1, end };
  if (index === end) return { start, end: end - 1 };
  if (index === start - 1) return end - index + 1 <= maxLines ? { start: index, end } : selection;
  if (index === end + 1) return index - start + 1 <= maxLines ? { start, end: index } : selection;
  return { start: index, end: index };
}

export function getSelectedLyrics(segments, selection) {
  if (!Array.isArray(segments) || !selection) return [];
  return segments.slice(selection.start, selection.end + 1);
}

export function getLyricsShareIndex(segments, position, activeIndex = -1) {
  if (Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < (segments?.length || 0)) return activeIndex;
  if (!Array.isArray(segments) || segments.length === 0 || !Number.isFinite(position)) return 0;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (Number(segments[index]?.start) <= position) return index;
  }
  return 0;
}

export function getLyricsCandidateWindow(anchorIndex, segmentCount, maxLines = MAX_SHARED_LYRICS) {
  const count = Math.max(0, Number(segmentCount) || 0);
  if (count === 0) return { start: 0, end: -1 };
  const size = Math.min(Math.max(1, Number(maxLines) || MAX_SHARED_LYRICS), count);
  const anchor = Math.max(0, Math.min(Number(anchorIndex) || 0, count - 1));
  const start = Math.max(0, Math.min(anchor - Math.floor(size / 2), count - size));
  return { start, end: start + size - 1 };
}

export function sanitizeLyricsFilename(title) {
  const safeTitle = String(title || "lyrics")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${safeTitle || "lyrics"}-lyrics.png`;
}

export function getLyricsShareMetadata(media, artworkUrl = null) {
  const title = typeof media?.title === "string" && media.title.trim() ? media.title.trim() : "Untitled track";
  const artists = resolveMediaArtist(media, "Unknown artist");
  return { title, artists, artworkUrl: artworkUrl || null };
}

export async function shareLyricsBlob(blob, { filename, title }) {
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: `${title} lyrics` });
    return "shared";
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
