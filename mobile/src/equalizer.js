import AsyncStorage from "@react-native-async-storage/async-storage";

export const EQ_STORAGE_KEY = "pfs:eq-settings";

export const EQ_BANDS = [
  { id: "31hz",  label: "31Hz",  frequency: 31 },
  { id: "62hz",  label: "62Hz",  frequency: 62 },
  { id: "125hz", label: "125Hz", frequency: 125 },
  { id: "250hz", label: "250Hz", frequency: 250 },
  { id: "500hz", label: "500Hz", frequency: 500 },
  { id: "1khz",  label: "1kHz",  frequency: 1000 },
  { id: "2khz",  label: "2kHz",  frequency: 2000 },
  { id: "4khz",  label: "4kHz",  frequency: 4000 },
  { id: "8khz",  label: "8kHz",  frequency: 8000 },
  { id: "16khz", label: "16kHz", frequency: 16000 },
];

export const EQ_PRESETS = {
  flat: {
    label: "Flat",
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  dialogue: {
    label: "Movie / Dialogue",
    gains: [-4, -2, 1, -1, 1, 3, 6, 4, 1, -2],
  },
  rock: {
    label: "Rock",
    gains: [3, 5, 3, 0, 3, 5, 5, 3, 2, 0],
  },
  pop: {
    label: "Pop",
    gains: [2, 3, 2, 0, 2, 3, 5, 5, 3, 2],
  },
  electronic: {
    label: "Electronic",
    gains: [8, 6, 3, -2, -2, 0, 3, 5, 6, 6],
  },
  metal: {
    label: "Metal",
    gains: [6, 8, 5, -2, -5, -3, 2, 5, 8, 6],
  },
  popRock: {
    label: "Pop Rock",
    gains: [5, 6, 3, 0, -2, 2, 3, 6, 5, 3],
  },
  funk: {
    label: "Funk / Disco",
    gains: [5, 8, 6, 2, 0, 2, 3, 5, 6, 5],
  },
  dreamPop: {
    label: "Dream Pop",
    gains: [3, 3, 2, 0, 0, 2, 3, 5, 6, 6],
  },
};

export const GAIN_MIN = -10;
export const GAIN_MAX = 10;

export function normalizeEqSettings(settings) {
  if (!settings || typeof settings !== "object") {
    return {
      enabled: false,
      preset: "flat",
      gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      targetDb: 0,
    };
  }
  const gains = Array.isArray(settings.gains)
    ? settings.gains.slice(0, 10).map((g) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, Number(g) || 0)))
    : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  while (gains.length < 10) gains.push(0);

  return {
    enabled: Boolean(settings.enabled),
    preset: typeof settings.preset === "string" ? settings.preset : "custom",
    gains,
    targetDb: Math.min(GAIN_MAX, Math.max(GAIN_MIN, Number(settings.targetDb) || 0)),
  };
}

export async function loadEqSettings() {
  try {
    const raw = await AsyncStorage.getItem(EQ_STORAGE_KEY);
    if (!raw) return null;
    return normalizeEqSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveEqSettings(settings) {
  const normalized = normalizeEqSettings(settings);
  try {
    await AsyncStorage.setItem(EQ_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* ignore */
  }
  return normalized;
}
