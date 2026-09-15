export const REQUESTED_QUALITIES = Object.freeze(["low", "med", "high", "ori"]);
export const ENCODED_QUALITIES = Object.freeze(["low", "med", "high"]);

export const ENCODING_PRESETS = Object.freeze({
  audio: {
    low: { bitrate: 96_000 },
    med: { bitrate: 160_000 },
    high: { bitrate: 256_000 },
  },
  video: {
    low: { height: 480, bitrate: 1_000_000, audioBitrate: 96_000 },
    med: { height: 720, bitrate: 2_500_000, audioBitrate: 160_000 },
    high: { height: 1080, bitrate: 5_000_000, audioBitrate: 256_000 },
  },
  image: {
    low: { longEdge: 640 },
    med: { longEdge: 1280 },
    high: { longEdge: 2048 },
  },
});

export function normalizeRequestedQuality(value, { defaultQuality = "ori" } = {}) {
  if (value === undefined || value === null || value === "") return defaultQuality;
  return REQUESTED_QUALITIES.includes(value) ? value : null;
}

export function mediaKind(mimeType = "") {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  return null;
}

export function shouldCreateVariant(kind, source, preset) {
  if (kind === "audio") return Number(source.bitrate || 0) > preset.bitrate;
  if (kind === "video") {
    return Number(source.height || 0) > preset.height || Number(source.bitrate || 0) > preset.bitrate;
  }
  if (kind === "image") {
    return Math.max(Number(source.width || 0), Number(source.height || 0)) > preset.longEdge;
  }
  return false;
}

export function selectActualQuality(requested, readyQualities = []) {
  if (requested === "ori") return "ori";
  const requestedIndex = ENCODED_QUALITIES.indexOf(requested);
  const ready = new Set(readyQualities);
  for (let index = requestedIndex; index >= 0; index -= 1) {
    if (ready.has(ENCODED_QUALITIES[index])) return ENCODED_QUALITIES[index];
  }
  return "ori";
}

export function encodingSummary(variants = []) {
  return Object.fromEntries(ENCODED_QUALITIES.map((quality) => {
    const variant = variants.find((item) => item.quality === quality);
    return [quality, variant ? {
      status: variant.status,
      attempts: Number(variant.attempts || 0),
      error: variant.last_error || null,
    } : { status: "queued", attempts: 0, error: null }];
  }));
}
