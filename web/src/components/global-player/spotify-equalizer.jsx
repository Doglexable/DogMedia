import { useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSliders } from "@fortawesome/free-solid-svg-icons/faSliders";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons/faRotateLeft";
import { faMusic } from "@fortawesome/free-solid-svg-icons/faMusic";
import { EQ_PRESETS, GAIN_MIN, GAIN_MAX, formatGain } from "./use-equalizer";

const SVG_WIDTH = 600;
const SVG_HEIGHT = 215;
const PAD_LEFT = 76;
const PAD_RIGHT = 24;
const PAD_TOP = 28;
const PAD_BOTTOM = 42;

const GRAPH_WIDTH = SVG_WIDTH - PAD_LEFT - PAD_RIGHT; // 500
const GRAPH_HEIGHT = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM; // 145

/**
 * Converts an array of points into a smooth Catmull-Rom cubic Bézier SVG path.
 */
export function getSplinePath(points) {
  if (!points || points.length < 2) return "";
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    let cp1x = p1.x + (p2.x - p0.x) / 6;
    let cp1y = p1.y + (p2.y - p0.y) / 6;
    let cp2x = p2.x - (p3.x - p1.x) / 6;
    let cp2y = p2.y - (p3.y - p1.y) / 6;

    // Clamp control point Y within the graph bounds
    cp1y = Math.max(PAD_TOP, Math.min(PAD_TOP + GRAPH_HEIGHT, cp1y));
    cp2y = Math.max(PAD_TOP, Math.min(PAD_TOP + GRAPH_HEIGHT, cp2y));

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/**
 * SpotifyEqualizer — 10-band equalizer matching Spotify's official playback curve visualizer.
 *
 * Props:
 *   gains        number[]      — 10 band gain values
 *   eqBands      Band[]        — 10 band definitions (label, frequency, type)
 *   preset       string        — active preset key or "custom"
 *   eqEnabled    boolean       — whether EQ audio processing is enabled
 *   gainMin      number        — minimum gain (-10)
 *   gainMax      number        — maximum gain (+10)
 *   onSetGain    (idx, v) => void
 *   onSetPreset  (key) => void
 *   onSetEnabled (bool) => void
 */
export function SpotifyEqualizer({
  gains = [],
  eqBands = [],
  preset = "flat",
  eqEnabled = false,
  gainMin = GAIN_MIN,
  gainMax = GAIN_MAX,
  onSetGain,
  onSetPreset,
  onSetEnabled,
}) {
  const svgRef = useRef(null);
  const [activeBand, setActiveBand] = useState(null);
  const [hoveredBand, setHoveredBand] = useState(null);

  // Compute (x, y) coordinates for all 10 bands
  const count = eqBands.length || 10;
  const points = eqBands.map((band, i) => {
    const x = PAD_LEFT + (i / Math.max(1, count - 1)) * GRAPH_WIDTH;
    const gain = Number(gains?.[i] ?? 0);
    const norm = (gainMax - gain) / (gainMax - gainMin);
    const y = PAD_TOP + norm * GRAPH_HEIGHT;
    return { x, y, gain, band, index: i };
  });

  const curvePath = getSplinePath(points);
  const bottomY = PAD_TOP + GRAPH_HEIGHT;
  const centerY = PAD_TOP + GRAPH_HEIGHT / 2;
  const areaPath = points.length > 1
    ? `${curvePath} L ${points[points.length - 1].x.toFixed(1)} ${bottomY.toFixed(1)} L ${points[0].x.toFixed(1)} ${bottomY.toFixed(1)} Z`
    : "";

  const updateGainFromEvent = (index, clientY) => {
    const svg = svgRef.current;
    if (!svg || typeof onSetGain !== "function") return;
    const rect = svg.getBoundingClientRect();
    const relY = clientY - rect.top;
    const scaleY = SVG_HEIGHT / rect.height;
    const svgY = relY * scaleY;

    const clampedY = Math.max(PAD_TOP, Math.min(PAD_TOP + GRAPH_HEIGHT, svgY));
    const norm = (clampedY - PAD_TOP) / GRAPH_HEIGHT;
    const rawGain = gainMax - norm * (gainMax - gainMin);
    const stepped = Math.round(rawGain * 2) / 2;
    const clampedGain = Math.max(gainMin, Math.min(gainMax, stepped));

    onSetGain(index, clampedGain);
  };

  const handlePointerDown = (index, e) => {
    if (!eqEnabled && typeof onSetEnabled === "function") {
      onSetEnabled(true);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveBand(index);
    updateGainFromEvent(index, e.clientY);
  };

  const handlePointerMove = (index, e) => {
    if (activeBand === index) {
      updateGainFromEvent(index, e.clientY);
    }
  };

  const handlePointerUp = (e) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
    setActiveBand(null);
  };

  const handleKeyDown = (index, e) => {
    const current = Number(gains?.[index] ?? 0);
    let next = current;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      next = Math.min(gainMax, current + 0.5);
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      next = Math.max(gainMin, current - 0.5);
      e.preventDefault();
    } else if (e.key === "PageUp") {
      next = Math.min(gainMax, current + 2);
      e.preventDefault();
    } else if (e.key === "PageDown") {
      next = Math.max(gainMin, current - 2);
      e.preventDefault();
    } else if (e.key === "Home") {
      next = gainMax;
      e.preventDefault();
    } else if (e.key === "End") {
      next = gainMin;
      e.preventDefault();
    } else if (e.key === "Delete" || e.key === "Backspace" || e.key === "0") {
      next = 0;
      e.preventDefault();
    } else {
      return;
    }
    if (!eqEnabled && typeof onSetEnabled === "function") {
      onSetEnabled(true);
    }
    onSetGain(index, next);
  };

  const activePresetData = EQ_PRESETS[preset];

  return (
    <div className="spotify-eq">
      {/* ── Top Header / On-Off switch ── */}
      <div className="spotify-eq-header">
        <div className="spotify-eq-title-wrap">
          <FontAwesomeIcon icon={faSliders} className="spotify-eq-header-icon" />
          <span className="spotify-eq-title">Playback Equalizer</span>
          <span className={`spotify-eq-status-badge ${eqEnabled ? "spotify-eq-status-badge--on" : ""}`}>
            {eqEnabled ? "ON" : "OFF"}
          </span>
        </div>
        <label className="eq-toggle" title={eqEnabled ? "Disable EQ" : "Enable EQ"}>
          <input
            type="checkbox"
            className="eq-toggle-input"
            checked={eqEnabled}
            onChange={(e) => onSetEnabled(e.target.checked)}
            aria-label="Enable equalizer"
          />
          <span className="eq-toggle-track" aria-hidden="true">
            <span className="eq-toggle-thumb" />
          </span>
        </label>
      </div>

      {/* ── Preset selector bar ── */}
      <div className="spotify-eq-controls-row">
        <div className="spotify-eq-preset-select-wrap">
          <span className="spotify-eq-preset-label">Preset:</span>
          <select
            className="spotify-eq-select"
            value={preset}
            disabled={!eqEnabled}
            aria-label="Select EQ preset"
            onChange={(e) => {
              onSetPreset(e.target.value);
              if (!eqEnabled) onSetEnabled(true);
            }}
          >
            {preset === "custom" && <option value="custom">Custom (Modified)</option>}
            {Object.entries(EQ_PRESETS).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="spotify-eq-reset-btn"
          onClick={() => {
            onSetPreset("flat");
            if (!eqEnabled) onSetEnabled(true);
          }}
          title="Reset to 0 dB Flat"
        >
          <FontAwesomeIcon icon={faRotateLeft} className="spotify-eq-reset-icon" />
          <span>Reset</span>
        </button>
      </div>

      {/* ── Preset Pills Scrollable Strip ── */}
      <div className="spotify-eq-pills-bar" role="group" aria-label="Presets">
        {Object.entries(EQ_PRESETS).map(([key, { label, genres }]) => (
          <button
            key={key}
            type="button"
            className={`spotify-eq-pill ${preset === key ? "spotify-eq-pill--active" : ""}`}
            onClick={() => {
              onSetPreset(key);
              if (!eqEnabled) onSetEnabled(true);
            }}
            title={genres ? `${label} • ${genres}` : label}
          >
            {label}
          </button>
        ))}
        {preset === "custom" && (
          <button
            type="button"
            className="spotify-eq-pill spotify-eq-pill--custom spotify-eq-pill--active"
            disabled
          >
            Custom
          </button>
        )}
      </div>

      {/* ── Genre badge hint ── */}
      {activePresetData?.genres && (
        <div className="spotify-eq-genre-tag" title={activePresetData.genres}>
          <FontAwesomeIcon icon={faMusic} className="spotify-eq-genre-icon" />
          <span className="spotify-eq-genre-text">
            <strong>Best for:</strong> {activePresetData.genres}
          </span>
        </div>
      )}

      {/* ── Spotify Official Visualizer Card ── */}
      <div
        className={`spotify-eq-card ${!eqEnabled ? "spotify-eq-card--disabled" : ""}`}
        aria-label="Equalizer frequency response curve"
      >
        <svg
          ref={svgRef}
          className="spotify-eq-svg"
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          preserveAspectRatio="none"
        >
          <defs>
            {/* Spotify Signature Misty White Gradient */}
            <linearGradient id="spotifyEqGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
              <stop offset="65%" stopColor="#ffffff" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
            </linearGradient>
            <filter id="spotifyEqGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Left Y-Axis dB Labels (+10dB and -10dB) */}
          <text
            x={18}
            y={PAD_TOP + 4}
            className="spotify-eq-db-label"
          >
            +10dB
          </text>
          <text
            x={18}
            y={bottomY + 4}
            className="spotify-eq-db-label"
          >
            -10dB
          </text>

          {/* Center 0 dB Horizontal Baseline Line (extends across with protrusion) */}
          <line
            x1={PAD_LEFT - 26}
            y1={centerY}
            x2={PAD_LEFT + GRAPH_WIDTH + 16}
            y2={centerY}
            className="spotify-eq-baseline"
          />

          {/* 10 Vertical Lines for Each Frequency Band */}
          {points.map((pt) => (
            <line
              key={`line-${pt.band.id}`}
              x1={pt.x}
              y1={PAD_TOP}
              x2={pt.x}
              y2={bottomY}
              className="spotify-eq-grid-vline"
            />
          ))}

          {/* Curve Area Gradient Fill */}
          {areaPath && (
            <path
              d={areaPath}
              fill="url(#spotifyEqGradient)"
              className="spotify-eq-area-fill"
            />
          )}

          {/* Main Pure White Curved Spline */}
          {curvePath && (
            <path
              d={curvePath}
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="spotify-eq-curve-line"
            />
          )}

          {/* Frequency Labels Below Vertical Lines */}
          {points.map((pt) => {
            const isHovered = hoveredBand === pt.index || activeBand === pt.index;
            return (
              <text
                key={`label-${pt.band.id}`}
                x={pt.x}
                y={bottomY + 22}
                textAnchor="middle"
                className={`spotify-eq-freq-label ${isHovered ? "spotify-eq-freq-label--active" : ""}`}
              >
                {pt.band.label}
              </text>
            );
          })}

          {/* Interactive Column Hit Targets & Solid White Circular Dots */}
          {points.map((pt) => {
            const colWidth = GRAPH_WIDTH / Math.max(1, count - 1);
            const isHovered = hoveredBand === pt.index || activeBand === pt.index;
            const isNearTop = pt.y < PAD_TOP + 18;
            const textY = isNearTop ? pt.y + 18 : pt.y - 12;

            return (
              <g
                key={`col-${pt.band.id}`}
                className="spotify-eq-col"
                onPointerDown={(e) => handlePointerDown(pt.index, e)}
                onPointerMove={(e) => handlePointerMove(pt.index, e)}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onMouseEnter={() => setHoveredBand(pt.index)}
                onMouseLeave={() => setHoveredBand(null)}
                onDoubleClick={() => onSetGain(pt.index, 0)}
                tabIndex={eqEnabled ? 0 : -1}
                role="slider"
                aria-label={`${pt.band.label} gain`}
                aria-valuenow={pt.gain}
                aria-valuemin={gainMin}
                aria-valuemax={gainMax}
                aria-valuetext={`${formatGain(pt.gain)} dB`}
                onKeyDown={(e) => handleKeyDown(pt.index, e)}
              >
                {/* Wide invisible hit area for easy touch/mouse dragging */}
                <rect
                  x={pt.x - colWidth / 2}
                  y={PAD_TOP - 8}
                  width={colWidth}
                  height={GRAPH_HEIGHT + 16}
                  fill="transparent"
                  cursor="ns-resize"
                />

                {/* Outer subtle glow on hover/active */}
                {isHovered && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="11"
                    className="spotify-eq-dot-halo"
                  />
                )}

                {/* Spotify Solid White Circular Dot */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? "6" : "4.5"}
                  className="spotify-eq-dot"
                />

                {/* Floating dB tooltip badge on hover/drag only */}
                {isHovered && (
                  <g pointerEvents="none" className="spotify-eq-floating-tooltip">
                    <rect
                      x={pt.x - 17}
                      y={textY - 9}
                      width="34"
                      height="15"
                      rx="4"
                      className="spotify-eq-tooltip-bg"
                    />
                    <text
                      x={pt.x}
                      y={textY + 2}
                      textAnchor="middle"
                      className="spotify-eq-tooltip-text"
                    >
                      {formatGain(pt.gain)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Subtle helper note */}
        <div className="spotify-eq-footer-hint">
          <span>Drag dots or vertical lines to adjust • Double-click any dot to reset to 0 dB</span>
        </div>
      </div>
    </div>
  );
}
