import { describe, expect, it, vi } from "vitest";
import {
  EQ_BANDS,
  EQ_PRESETS,
  GAIN_MIN,
  GAIN_MAX,
  PREAMP_GAIN_DB,
  PREAMP_LINEAR_GAIN,
  formatGain,
  getOrCreateMediaElementSource,
  calculateTargetShift,
  readStoredTargetDb,
  TARGET_DB_KEY,
} from "./use-equalizer";

describe("equalizer configuration & presets", () => {
  it("defines 10 ISO standard bands from 31Hz to 16kHz", () => {
    expect(EQ_BANDS).toHaveLength(10);
    const frequencies = EQ_BANDS.map((b) => b.frequency);
    expect(frequencies).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);

    expect(EQ_BANDS[0].type).toBe("lowshelf");
    expect(EQ_BANDS[9].type).toBe("highshelf");
    for (let i = 1; i <= 8; i++) {
      expect(EQ_BANDS[i].type).toBe("peaking");
    }
  });

  it("enforces symmetric ±10 dB gain range per context_eq.md", () => {
    expect(GAIN_MIN).toBe(-10);
    expect(GAIN_MAX).toBe(10);
  });

  it("configures unity preamp (0 dB) to preserve perceived loudness, protected by brickwall limiter", () => {
    expect(PREAMP_GAIN_DB).toBe(0);
    expect(PREAMP_LINEAR_GAIN).toBe(1.0);
  });

  it("contains all 10-band presets specified in context_eq.md", () => {
    const expectedPresets = {
      flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      dialogue: [-4, -2, 1, -1, 1, 3, 6, 4, 1, -2],
      rock: [3, 5, 3, 0, 3, 5, 5, 3, 2, 0],
      pop: [2, 3, 2, 0, 2, 3, 5, 5, 3, 2],
      electronic: [8, 6, 3, -2, -2, 0, 3, 5, 6, 6],
      metal: [6, 8, 5, -2, -5, -3, 2, 5, 8, 6],
      popRock: [5, 6, 3, 0, -2, 2, 3, 6, 5, 3],
      funk: [5, 8, 6, 2, 0, 2, 3, 5, 6, 5],
      dreamPop: [3, 3, 2, 0, 0, 2, 3, 5, 6, 6],
    };

    for (const [key, gains] of Object.entries(expectedPresets)) {
      expect(EQ_PRESETS[key]).toBeDefined();
      expect(EQ_PRESETS[key].gains).toHaveLength(10);
      expect(EQ_PRESETS[key].gains).toEqual(gains);
      // All gains must be within ±10 dB
      for (const g of EQ_PRESETS[key].gains) {
        expect(g).toBeGreaterThanOrEqual(GAIN_MIN);
        expect(g).toBeLessThanOrEqual(GAIN_MAX);
      }
    }
  });

  it("configures Movie / Dialogue preset specifically to boost actor voice intelligibility", () => {
    const dialogue = EQ_PRESETS.dialogue;
    expect(dialogue.label).toContain("Dialogue");
    expect(dialogue.genres).toMatch(/Film|Video|Voice|Speech/);

    // Band indexes: 0: 31Hz, 1: 62Hz, 2: 125Hz, 3: 250Hz, 4: 500Hz, 5: 1kHz, 6: 2kHz, 7: 4kHz, 8: 8kHz, 9: 16kHz
    const [b31, b62, b125, b250, , b1k, b2k, b4k, , b16k] = dialogue.gains;

    // Sub-bass rumble cut to prevent masking speech
    expect(b31).toBeLessThan(0);
    expect(b62).toBeLessThan(0);

    // Warmth preserved, boxy mud cut
    expect(b125).toBeGreaterThan(0);
    expect(b250).toBeLessThan(0);

    // Speech presence and intelligibility boosted, peaking at 2kHz
    expect(b1k).toBeGreaterThan(0);
    expect(b2k).toBeGreaterThan(b1k);
    expect(b2k).toBeGreaterThan(b4k);
    expect(b4k).toBeGreaterThan(0);

    // Tames high-frequency harshness
    expect(b16k).toBeLessThan(0);
  });

  it("formats gain numbers compactly with sign and decimal handling", () => {
    expect(formatGain(0)).toBe("0");
    expect(formatGain(6)).toBe("+6");
    expect(formatGain(10)).toBe("+10");
    expect(formatGain(-5)).toBe("-5");
    expect(formatGain(-10)).toBe("-10");
    expect(formatGain(2.5)).toBe("+2.5");
    expect(formatGain(-0.5)).toBe("-0.5");
  });
});

describe("equalizer media source lifecycle", () => {
  it("creates only one source node for the same media element", () => {
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const context = { createMediaElementSource: vi.fn(() => source) };
    const element = {};
    const cache = new WeakMap();

    expect(getOrCreateMediaElementSource(context, element, cache)).toBe(source);
    expect(getOrCreateMediaElementSource(context, element, cache)).toBe(source);
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it("creates separate source nodes for different media elements", () => {
    const context = { createMediaElementSource: vi.fn((element) => ({ element })) };
    const firstElement = {};
    const secondElement = {};
    const cache = new WeakMap();

    expect(getOrCreateMediaElementSource(context, firstElement, cache)).not.toBe(
      getOrCreateMediaElementSource(context, secondElement, cache),
    );
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(2);
  });
});

describe("target dB shift & adjustment", () => {
  it("shifts all bands so the peak matches target dB exactly", () => {
    const rockGains = [3, 5, 3, 0, 3, 5, 5, 3, 2, 0]; // peak is 5
    const shiftedTo8 = calculateTargetShift(rockGains, 8);

    expect(Math.max(...shiftedTo8)).toBe(8);
    expect(shiftedTo8).toEqual([6, 8, 6, 3, 6, 8, 8, 6, 5, 3]);

    const shiftedTo0 = calculateTargetShift(rockGains, 0);
    expect(Math.max(...shiftedTo0)).toBe(0);
    expect(shiftedTo0).toEqual([-2, 0, -2, -5, -2, 0, 0, -2, -3, -5]);
  });

  it("sets all bands uniformly when starting from a flat curve", () => {
    const flatGains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const shifted = calculateTargetShift(flatGains, 4.5);

    expect(shifted).toEqual([4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5]);
    expect(Math.max(...shifted)).toBe(4.5);
  });

  it("clamps bands that exceed GAIN_MAX or GAIN_MIN after shift", () => {
    const metalGains = [6, 8, 5, -2, -5, -3, 2, 5, 8, 6]; // peak is 8, lowest is -5
    // Target +10 dB: offset is +2 dB, so peak hits 10, lowest becomes -3
    const shiftedUp = calculateTargetShift(metalGains, 10, -10, 10);
    expect(Math.max(...shiftedUp)).toBe(10);
    expect(shiftedUp[1]).toBe(10);
    expect(shiftedUp[8]).toBe(10);

    // Target -6 dB: offset is -14 dB (-6 - 8 = -14)
    // -5 - 14 = -19, which must clamp to -10
    const shiftedDown = calculateTargetShift(metalGains, -6, -10, 10);
    expect(Math.max(...shiftedDown)).toBe(-6);
    expect(Math.min(...shiftedDown)).toBe(-10);
    for (const g of shiftedDown) {
      expect(g).toBeGreaterThanOrEqual(-10);
      expect(g).toBeLessThanOrEqual(10);
    }
  });

  it("handles empty gains gracefully", () => {
    expect(calculateTargetShift([], 5)).toEqual([]);
  });

  it("reads stored target dB from localStorage or falls back to 0", () => {
    expect(readStoredTargetDb()).toBe(0);

    const mockStorage = new Map();
    const originalWindow = globalThis.window;
    globalThis.window = {
      localStorage: {
        getItem: (k) => mockStorage.get(k) ?? null,
        setItem: (k, v) => mockStorage.set(k, String(v)),
        removeItem: (k) => mockStorage.delete(k),
      },
    };

    try {
      window.localStorage.setItem(TARGET_DB_KEY, "6.5");
      expect(readStoredTargetDb()).toBe(6.5);

      window.localStorage.setItem(TARGET_DB_KEY, "15"); // Exceeds GAIN_MAX (10)
      expect(readStoredTargetDb()).toBe(10);

      window.localStorage.removeItem(TARGET_DB_KEY);
      expect(readStoredTargetDb()).toBe(0);
    } finally {
      if (originalWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = originalWindow;
      }
    }
  });
});

