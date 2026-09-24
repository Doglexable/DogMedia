import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSliders } from "@fortawesome/free-solid-svg-icons/faSliders";
import { GAIN_MIN, GAIN_MAX } from "./use-equalizer";
import { SpotifyEqualizer } from "./spotify-equalizer";

/**
 * EqControl — button + popover panel for the 10-band Spotify-style equalizer.
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
  gainMin = GAIN_MIN,
  gainMax = GAIN_MAX,
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
          <SpotifyEqualizer
            gains={gains}
            eqBands={eqBands}
            preset={preset}
            eqEnabled={eqEnabled}
            gainMin={gainMin}
            gainMax={gainMax}
            onSetGain={onSetGain}
            onSetPreset={onSetPreset}
            onSetEnabled={onSetEnabled}
          />
        </div>
      )}
    </div>
  );
}
