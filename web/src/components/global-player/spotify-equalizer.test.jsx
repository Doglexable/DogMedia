import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SpotifyEqualizer, getSplinePath } from "./spotify-equalizer";
import { EQ_BANDS, EQ_PRESETS } from "./use-equalizer";

describe("getSplinePath helper", () => {
  it("returns empty string for empty or single-point arrays", () => {
    expect(getSplinePath([])).toBe("");
    expect(getSplinePath([{ x: 10, y: 20 }])).toBe("");
  });

  it("generates continuous cubic Bézier segments for multi-point paths", () => {
    const points = [
      { x: 38, y: 96 },
      { x: 90, y: 60 },
      { x: 142, y: 40 },
      { x: 194, y: 96 },
    ];
    const path = getSplinePath(points);
    expect(path).toContain("M 38.0 96.0");
    expect(path).toContain("C ");
    expect(path).toContain("194.0 96.0");
  });
});

describe("SpotifyEqualizer component", () => {
  const defaultProps = {
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    eqBands: EQ_BANDS,
    preset: "flat",
    eqEnabled: true,
    gainMin: -10,
    gainMax: 10,
    onSetGain: vi.fn(),
    onSetPreset: vi.fn(),
    onSetEnabled: vi.fn(),
  };

  it("renders the 10 ISO standard frequency band labels", () => {
    const markup = renderToStaticMarkup(<SpotifyEqualizer {...defaultProps} />);

    for (const band of EQ_BANDS) {
      expect(markup).toContain(band.label);
    }
  });

  it("renders Spotify-style dB labels (+10dB, -10dB) and baseline", () => {
    const markup = renderToStaticMarkup(<SpotifyEqualizer {...defaultProps} />);

    expect(markup).toContain("+10dB");
    expect(markup).toContain("-10dB");
    expect(markup).toContain("spotify-eq-baseline");
  });

  it("renders the SVG frequency response spline and area gradient", () => {
    const markup = renderToStaticMarkup(<SpotifyEqualizer {...defaultProps} />);

    expect(markup).toContain("spotify-eq-svg");
    expect(markup).toContain("spotifyEqGradient");
    expect(markup).toContain("spotify-eq-area-fill");
    expect(markup).toContain("spotify-eq-curve-line");
  });

  it("renders preset pills for all presets and reset button without redundant select dropdown", () => {
    const markup = renderToStaticMarkup(<SpotifyEqualizer {...defaultProps} />);

    for (const { label } of Object.values(EQ_PRESETS)) {
      expect(markup).toContain(label.replace(/&/g, "&amp;"));
    }
    expect(markup).not.toContain("spotify-eq-select");
    expect(markup).toContain("spotify-eq-pills-bar");
    expect(markup).toContain("spotify-eq-reset-btn");
  });

  it("shows active preset styling and genre descriptions", () => {
    const metalProps = {
      ...defaultProps,
      preset: "metal",
      gains: EQ_PRESETS.metal.gains,
    };
    const markup = renderToStaticMarkup(<SpotifyEqualizer {...metalProps} />);

    expect(markup).toContain("spotify-eq-pill--active");
    expect(markup).toContain("Alternative Metal");
    expect(markup).toContain("Djent");
  });

  it("reflects ON/OFF status and disables interaction when eqEnabled is false", () => {
    const disabledProps = {
      ...defaultProps,
      eqEnabled: false,
    };
    const markup = renderToStaticMarkup(<SpotifyEqualizer {...disabledProps} />);

    expect(markup).toContain("OFF");
    expect(markup).toContain("spotify-eq-card--disabled");
    expect(markup).not.toContain("spotify-eq-status-badge--on");
  });

  it("displays gain values compactly on knobs", () => {
    const testGains = [6, 8, 5, -2, -5, -3, 2, 5, 8, 6];
    const markup = renderToStaticMarkup(
      <SpotifyEqualizer {...defaultProps} gains={testGains} />
    );

    expect(markup).toContain("+6");
    expect(markup).toContain("+8");
    expect(markup).toContain("-2");
    expect(markup).toContain("-5");
  });
});
