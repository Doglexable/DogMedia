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
  return "ori";
}
