const MAX_LANGUAGE_LENGTH = 32;
const MAX_SEGMENTS = 5000;

export class LyricsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LyricsValidationError";
  }
}

export function normalizeWhisperLyrics(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new LyricsValidationError("Lyrics must be a JSON object");
  }

  if (!Array.isArray(payload.segments)) {
    throw new LyricsValidationError("Lyrics segments must be an array");
  }
  if (payload.segments.length > MAX_SEGMENTS) {
    throw new LyricsValidationError(`Lyrics cannot contain more than ${MAX_SEGMENTS} segments`);
  }

  const language = typeof payload.language === "string" ? payload.language.trim() : "";
  if (language.length > MAX_LANGUAGE_LENGTH) {
    throw new LyricsValidationError(`Lyrics language cannot exceed ${MAX_LANGUAGE_LENGTH} characters`);
  }

  const segments = [];
  for (const [index, segment] of payload.segments.entries()) {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
      throw new LyricsValidationError(`Lyrics segment ${index + 1} must be an object`);
    }

    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    if (!text) continue;

    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      throw new LyricsValidationError(`Lyrics segment ${index + 1} has invalid timing`);
    }

    segments.push({ start, end, text });
  }

  if (segments.length === 0) {
    throw new LyricsValidationError("Lyrics must contain at least one non-empty segment");
  }

  segments.sort((a, b) => a.start - b.start || a.end - b.end);
  return { language: language || null, segments };
}

