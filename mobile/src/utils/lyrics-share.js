export const MAX_SHARED_LYRICS = 5;
export const LYRICS_CARD_SIZE = Object.freeze({ width: 1920, height: 1080 });

export function accessibleTextColor(backgroundHex) {
  if (!/^#[0-9a-f]{6}$/i.test(backgroundHex || "")) return "#ffffff";
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(backgroundHex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

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

export function getLyricsShareMetadata(media, artworkUri = null) {
  const title = typeof media?.title === "string" && media.title.trim() ? media.title.trim() : "Untitled track";
  const artists = typeof media?.artists === "string" && media.artists.trim() ? media.artists.trim() : "Unknown artist";
  return { title, artists, artworkUri: artworkUri || null };
}

export function getLyricsPickerOffset({ gap = 0, index, itemWidth, viewportWidth }) {
  const safeIndex = Math.max(0, Number(index) || 0);
  const safeItemWidth = Math.max(0, Number(itemWidth) || 0);
  const safeGap = Math.max(0, Number(gap) || 0);
  const safeViewportWidth = Math.max(0, Number(viewportWidth) || 0);
  return Math.max(0, safeIndex * (safeItemWidth + safeGap) - (safeViewportWidth - safeItemWidth) / 2);
}

export function isShareCancellation(error) {
  return error?.name === "AbortError" || error?.code === "ERR_CANCELED" || error?.code === "ERR_CANCELLED";
}

export async function captureAndShareLyrics({ capture, deleteFile, isAvailable, share }) {
  let uri;
  try {
    if (!await isAvailable()) throw new Error("Sharing is unavailable");
    uri = await capture();
    await share(uri);
    return "shared";
  } catch (error) {
    if (isShareCancellation(error)) return "cancelled";
    throw error;
  } finally {
    if (uri) await deleteFile(uri).catch(() => {});
  }
}
