import { describe, expect, it, vi, beforeEach } from "vitest";

const store = new Map();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key) => store.get(key) || null),
    setItem: vi.fn(async (key, val) => { store.set(key, val); }),
    removeItem: vi.fn(async (key) => { store.delete(key); }),
    clear: vi.fn(async () => { store.clear(); }),
  },
}));

import {
  EQ_BANDS,
  EQ_PRESETS,
  GAIN_MIN,
  GAIN_MAX,
  normalizeEqSettings,
  loadEqSettings,
  saveEqSettings,
} from "./equalizer";

describe("mobile equalizer module", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("defines standard 10 EQ bands from 31Hz to 16kHz", () => {
    expect(EQ_BANDS).toHaveLength(10);
    expect(EQ_BANDS[0].frequency).toBe(31);
    expect(EQ_BANDS[9].frequency).toBe(16000);
  });

  it("normalizes invalid or missing EQ settings with safe defaults", () => {
    const fallback = normalizeEqSettings(null);
    expect(fallback.enabled).toBe(false);
    expect(fallback.preset).toBe("flat");
    expect(fallback.gains).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("clamps out-of-range gain values to -10 and +10", () => {
    const normalized = normalizeEqSettings({
      enabled: true,
      preset: "custom",
      gains: [-25, 15, 3, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(normalized.enabled).toBe(true);
    expect(normalized.gains[0]).toBe(GAIN_MIN);
    expect(normalized.gains[1]).toBe(GAIN_MAX);
    expect(normalized.gains[2]).toBe(3);
  });

  it("loads and saves EQ settings via AsyncStorage", async () => {
    const testSettings = {
      enabled: true,
      preset: "rock",
      gains: EQ_PRESETS.rock.gains,
      targetDb: 2,
    };
    await saveEqSettings(testSettings);
    const loaded = await loadEqSettings();
    expect(loaded).toMatchObject({
      enabled: true,
      preset: "rock",
    });
    expect(loaded.gains).toEqual(EQ_PRESETS.rock.gains);
  });
});
