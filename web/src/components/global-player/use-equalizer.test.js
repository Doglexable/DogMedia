import { describe, expect, it, vi } from "vitest";
import {
  EQ_BANDS,
  EQ_PRESETS,
  GAIN_MIN,
  GAIN_MAX,
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

  it("contains all 10-band presets specified in context_eq.md", () => {
    const expectedPresets = {
      flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
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
