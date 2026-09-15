import AsyncStorage from "@react-native-async-storage/async-storage";

export const MEDIA_QUALITY_STORAGE_KEY = "pfs:media-quality";
export const MEDIA_QUALITIES = ["low", "med", "high", "ori"];

export function normalizeMediaQuality(value) {
  return MEDIA_QUALITIES.includes(value) ? value : "high";
}

export async function getStoredMediaQuality() {
  return normalizeMediaQuality(await AsyncStorage.getItem(MEDIA_QUALITY_STORAGE_KEY));
}

export async function storeMediaQuality(value) {
  const quality = normalizeMediaQuality(value);
  await AsyncStorage.setItem(MEDIA_QUALITY_STORAGE_KEY, quality);
  return quality;
}

export function actualMediaQuality(requested, available = ["ori"]) {
  if (requested === "ori") return "ori";
  const tiers = ["low", "med", "high"];
  const ready = new Set(available);
  for (let index = tiers.indexOf(requested); index >= 0; index -= 1) {
    if (ready.has(tiers[index])) return tiers[index];
  }
  return "ori";
}
