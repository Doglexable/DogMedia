export function findActiveLyricsIndex(segments, position) {
  if (!Array.isArray(segments) || !Number.isFinite(position)) return -1;
  return segments.findIndex((segment) => position >= segment.start && position <= segment.end);
}

export function normalizeLyricsResponse(payload, expectedMediaId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Lyrics response must be an object");
  }

  const mediaId = Number(payload.mediaId);
  if (!Number.isFinite(mediaId) || (expectedMediaId != null && mediaId !== Number(expectedMediaId))) {
    throw new TypeError("Lyrics response has an invalid media id");
  }
  if (!Array.isArray(payload.segments)) {
    throw new TypeError("Lyrics response must include segments");
  }

  const segments = payload.segments.map((segment) => {
    const start = Number(segment?.start);
    const end = Number(segment?.end);
    const text = typeof segment?.text === "string" ? segment.text.trim() : "";
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      throw new TypeError("Lyrics response contains an invalid segment");
    }
    return { start, end, text };
  });

  return {
    mediaId,
    language: typeof payload.language === "string" && payload.language.trim() ? payload.language.trim() : null,
    segments,
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
  };
}

export function getCenteredLyricsOffset({ contentHeight, lineHeight, lineY, viewportHeight }) {
  const normalizedContentHeight = Math.max(0, Number(contentHeight) || 0);
  const normalizedLineHeight = Math.max(0, Number(lineHeight) || 0);
  const normalizedLineY = Math.max(0, Number(lineY) || 0);
  const normalizedViewportHeight = Math.max(0, Number(viewportHeight) || 0);
  const target = normalizedLineY + normalizedLineHeight / 2 - normalizedViewportHeight / 2;
  return Math.max(0, Math.min(target, Math.max(0, normalizedContentHeight - normalizedViewportHeight)));
}
