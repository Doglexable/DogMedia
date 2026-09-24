import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSliders } from "@fortawesome/free-solid-svg-icons/faSliders";
import { EQ_PRESETS } from "./use-equalizer";

/**
 * EqControl — button + popover panel for the 5-band equalizer.
 *
 * Props:
 *   gains        number[]      — current per-band gain values
 *   eqBands      Band[]        — band definitions from useEqualizer
 *   preset       string        — active preset key or "custom"
 *   eqEnabled    boolean
 *   gainMin      number
 *   gainMax      number
 *   onSetGain    (idx, v) => void
 *   onSetPreset  (key) => void
 *   onSetEnabled (bool) => void
 *   variant      "fullscreen" | "video-ctrl" | "ghost"
 */
export function EqControl({
  gains,
  eqBands,
  preset,
  eqEnabled,
  gainMin = -12,
  gainMax = 12,
  onSetGain,
  onSetPreset,
  onSetEnabled,
  variant = "ghost",
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const buttonClass =
    variant === "fullscreen"
      ? `fullscreen-player-icon-button ${eqEnabled ? "fullscreen-player-icon-button--active" : ""}`
      : variant === "video-ctrl"
        ? `video-player-ctrl-btn ${eqEnabled ? "video-player-ctrl-btn--active" : ""}`
        : `player-ghost-button ${eqEnabled ? "text-[var(--primary)]" : "text-muted"}`;

  const containerClass = [
    "eq-control",
    variant === "fullscreen" ? "eq-control--fullscreen" : "",
    variant === "video-ctrl" ? "eq-control--video-ctrl" : "",
    open ? "eq-control--open" : "",
  ].filter(Boolean).join(" ");

  return (
    <div ref={containerRef} className={containerClass}>
      <button
        type="button"
        className={buttonClass}
        aria-label="Equalizer"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`Equalizer${eqEnabled ? " (On)" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <FontAwesomeIcon icon={faSliders} />
        {eqEnabled && <span className="eq-active-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className={`eq-panel ${variant === "video-ctrl" ? "eq-panel--video-ctrl" : ""} ${variant === "fullscreen" ? "eq-panel--fullscreen" : ""}`} role="dialog" aria-label="Equalizer">
          {/* Header row */}
          <div className="eq-panel-header">
            <span className="eq-panel-title">Equalizer</span>
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

          {/* Preset strip */}
          <div className="eq-presets" role="group" aria-label="Presets">
            {Object.entries(EQ_PRESETS).map(([key, { label }]) => (
              <button
                key={key}
                type="button"
                className={`eq-preset-btn ${preset === key ? "eq-preset-btn--active" : ""}`}
                onClick={() => {
                  onSetPreset(key);
                  if (!eqEnabled) onSetEnabled(true);
                }}
                title={label}
              >
                {label}
              </button>
            ))}
            {preset === "custom" && (
              <button
                type="button"
                className="eq-preset-btn eq-preset-btn--custom eq-preset-btn--active"
                disabled
              >
                Custom
              </button>
            )}
          </div>

          {/* Band sliders */}
          <div className={`eq-bands ${!eqEnabled ? "eq-bands--disabled" : ""}`} aria-label="EQ bands">
            {eqBands.map((band, i) => (
              <div key={band.id} className="eq-band">
                <span className="eq-band-gain" aria-hidden="true">
                  {gains[i] >= 0 ? `+${gains[i].toFixed(1)}` : gains[i].toFixed(1)}
                </span>
                <input
                  type="range"
                  className="eq-slider"
                  orient="vertical"
                  min={gainMin}
                  max={gainMax}
                  step={0.5}
                  value={gains[i]}
                  disabled={!eqEnabled}
                  aria-label={`${band.label} gain`}
                  aria-valuetext={`${gains[i] >= 0 ? "+" : ""}${gains[i].toFixed(1)} dB`}
                  onChange={(e) => {
                    onSetGain(i, Number(e.target.value));
                    if (!eqEnabled) onSetEnabled(true);
                  }}
                />
                <span className="eq-band-label">{band.label}</span>
                <span className="eq-band-freq" aria-hidden="true">
                  {band.frequency >= 1000 ? `${band.frequency / 1000}k` : `${band.frequency}`}
                </span>
              </div>
            ))}
          </div>

          {/* Reset button */}
          <button
            type="button"
            className="eq-reset-btn"
            onClick={() => {
              onSetPreset("flat");
              if (!eqEnabled) onSetEnabled(true);
            }}
            title="Reset to flat"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
