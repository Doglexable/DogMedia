export function findActiveLyricsIndex(segments, position) {
  if (!Array.isArray(segments) || !Number.isFinite(position)) return -1;
  return segments.findIndex((segment) => position >= segment.start && position <= segment.end);
}

export const MIN_INSTRUMENTAL_GAP_SECONDS = 3;

export function buildLyricsDisplaySegments(segments, minimumGap = MIN_INSTRUMENTAL_GAP_SECONDS) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const displaySegments = [];
  const appendInstrumental = (start, end) => {
    if (end - start < minimumGap) return;
    displaySegments.push({
      start,
      end: Number((end - 0.001).toFixed(3)),
      text: "Instrumental",
      instrumental: true,
    });
  };

  appendInstrumental(0, Number(segments[0].start));
  segments.forEach((segment, lyricIndex) => {
    displaySegments.push({ ...segment, instrumental: false, lyricIndex });
    const next = segments[lyricIndex + 1];
    if (next) appendInstrumental(Number(segment.end), Number(next.start));
  });

  return displaySegments;
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
