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

  it("configures a -10 dB preamp attenuation headroom to prevent digital clipping", () => {
    expect(PREAMP_GAIN_DB).toBe(-10);
    expect(PREAMP_GAIN_DB).toBe(-GAIN_MAX);
    expect(PREAMP_LINEAR_GAIN).toBeCloseTo(Math.pow(10, -10 / 20), 5);
    expect(PREAMP_LINEAR_GAIN).toBeCloseTo(0.316227, 4);

    // Any boost up to GAIN_MAX (+10 dB) plus preamp headroom (-10 dB) remains <= 0 dBFS
    const maxBoost = GAIN_MAX;
    const peakLevel = PREAMP_GAIN_DB + maxBoost;
    expect(peakLevel).toBeLessThanOrEqual(0);
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
