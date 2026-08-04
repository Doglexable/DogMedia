export function findActiveLyricsIndex(segments, position) {
  if (!Array.isArray(segments) || !Number.isFinite(position)) return -1;
  return segments.findIndex((segment) => position >= segment.start && position <= segment.end);
}
