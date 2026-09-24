import { describe, expect, it, vi } from "vitest";
import { getOrCreateMediaElementSource } from "./use-equalizer";

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
