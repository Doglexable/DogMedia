export const MEDIA_QUALITIES = ["low", "med", "high", "ori"];
export const MEDIA_QUALITY_STORAGE_KEY = "pfs:media-quality";

export function normalizeMediaQuality(value) {
  return MEDIA_QUALITIES.includes(value) ? value : "high";
}

export function readMediaQuality(storage = globalThis?.localStorage) {
  try { return normalizeMediaQuality(storage?.getItem(MEDIA_QUALITY_STORAGE_KEY)); } catch { return "high"; }
}

export function actualMediaQuality(requested, available = ["ori"]) {
  const tiers = ["low", "med", "high"];
  if (requested === "ori") return "ori";
  const ready = new Set(available);
  for (let index = tiers.indexOf(requested); index >= 0; index -= 1) {
    if (ready.has(tiers[index])) return tiers[index];
  }
  for (let index = tiers.indexOf(requested) + 1; index < tiers.length; index += 1) {
    if (ready.has(tiers[index])) return tiers[index];
  }
  return ready.has("ori") ? "ori" : null;
}

export function visibleMediaQualities(available) {
  return Array.isArray(available)
    ? MEDIA_QUALITIES.filter((quality) => available.includes(quality))
    : MEDIA_QUALITIES;
}
