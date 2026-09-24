import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAlarmClock } from "@fortawesome/free-solid-svg-icons/faAlarmClock";
import { faBolt } from "@fortawesome/free-solid-svg-icons/faBolt";
import { faGear } from "@fortawesome/free-solid-svg-icons/faGear";
import { faSignal } from "@fortawesome/free-solid-svg-icons/faSignal";
import { faSliders } from "@fortawesome/free-solid-svg-icons/faSliders";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { EQ_BANDS, EQ_PRESETS, GAIN_MIN, GAIN_MAX } from "./use-equalizer";
import { getQualityBitrateLabel } from "./player-controls";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
const QUALITY_OPTIONS = [
  { value: "ori", label: "Original", badge: "ORI" },
  { value: "high", label: "High",     badge: "HD"  },
  { value: "med",  label: "Medium",   badge: "MED" },
  { value: "low",  label: "Low",      badge: "LOW" },
];
const SLEEP_TIMER_PRESETS = [5, 15, 30, 45, 60];

function formatSleepTimer(seconds) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

const TABS = [
  { id: "quality", label: "Quality", icon: faSignal },
  { id: "eq",      label: "EQ",      icon: faSliders },
  { id: "speed",   label: "Speed",   icon: faBolt },
  { id: "timer",   label: "Timer",   icon: faAlarmClock },
];

/**
 * SettingsControl — single gear-icon button that opens a tabbed panel
 * combining Quality, EQ, Playback Speed, and Sleep Timer.
 *
 * Props:
 *   variant           "fullscreen" | "video-ctrl"
 *   showSpeed         boolean  — hide Speed tab for audio-only contexts
 *
 *   Quality:
 *     currentMedia, quality, actualQuality, onChangeQuality
 *
 *   EQ:
 *     gains[], eqBands[], eqPreset, eqEnabled, gainMin, gainMax
 *     onSetGain, onSetEqPreset, onSetEqEnabled
 *
 *   Speed (video):
 *     playbackRate, onSelectRate
 *
 *   Sleep Timer:
 *     sleepTimerRemaining, sleepTimerMode, hasPlaylist, onSetSleepTimer
 */
export function SettingsControl({
  variant = "video-ctrl",
  showSpeed = true,
  // quality
  currentMedia,
  quality = "ori",
  actualQuality,
  onChangeQuality,
  // eq
  gains,
  eqPreset,
  eqEnabled,
  onSetGain,
  onSetEqPreset,
  onSetEqEnabled,
  // speed
  playbackRate = 1,
  onSelectRate,
  // sleep timer
  sleepTimerRemaining = 0,
  sleepTimerMode = null,
  hasPlaylist = false,
  onSetSleepTimer,
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("quality");
  const containerRef = useRef(null);

  // Determine which tabs to show
  const visibleTabs = TABS.filter((t) => t.id !== "speed" || showSpeed);

  // Badge counts for active state indicators
  const timerActive = Boolean(sleepTimerMode) || sleepTimerRemaining > 0;
  const eqActive    = eqEnabled;
  const qualityMod  = quality !== "ori";
  const speedMod    = playbackRate !== 1;
  const anyActive   = timerActive || eqActive || qualityMod || speedMod;

  // Close on outside click / Escape
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
      ? `fullscreen-player-icon-button ${anyActive ? "fullscreen-player-icon-button--active" : ""}`
      : `video-player-ctrl-btn ${anyActive ? "video-player-ctrl-btn--active" : ""}`;

  const visibleQualityOptions = Array.isArray(currentMedia?.available_qualities)
    && !currentMedia.available_qualities.includes("ori")
    ? QUALITY_OPTIONS.filter((o) => o.value !== "ori")
    : QUALITY_OPTIONS;

  return (
    <div
      ref={containerRef}
      className={`settings-control ${variant === "fullscreen" ? "settings-control--fullscreen" : ""} ${open ? "settings-control--open" : ""}`}
    >
      {/* Trigger button */}
      <button
        type="button"
        className={buttonClass}
        aria-label="Settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Settings"
        onClick={() => setOpen((p) => !p)}
      >
        <FontAwesomeIcon icon={faGear} />
        {anyActive && <span className="settings-active-dot" aria-hidden="true" />}
      </button>

      {/* Panel */}
      {open && (
        <div
          className={`settings-panel ${variant === "fullscreen" ? "settings-panel--fullscreen" : ""}`}
          role="dialog"
          aria-label="Settings"
        >
          {/* Tab strip */}
          <div className="settings-tabs" role="tablist">
            {visibleTabs.map((t) => {
              const tabActive =
                (t.id === "eq" && eqActive) ||
                (t.id === "quality" && qualityMod) ||
                (t.id === "speed" && speedMod) ||
                (t.id === "timer" && timerActive);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.id}
                  className={`settings-tab-btn ${activeTab === t.id ? "settings-tab-btn--active" : ""}`}
                  onClick={() => setActiveTab(t.id)}
                  title={t.label}
                >
                  <FontAwesomeIcon icon={t.icon} />
                  <span className="settings-tab-label">{t.label}</span>
                  {tabActive && <span className="settings-tab-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="settings-tab-content" role="tabpanel">

            {/* ── Quality ── */}
            {activeTab === "quality" && (
              <div className="settings-section">
                <div className="settings-section-header">
                  <FontAwesomeIcon icon={faSignal} />
                  <span>Quality</span>
                  {actualQuality && actualQuality !== quality && (
                    <span className="settings-section-badge">→ {actualQuality.toUpperCase()}</span>
                  )}
                </div>
                <div className="settings-quality-options">
                  {visibleQualityOptions.map((opt) => {
                    const isSelected = opt.value === quality;
                    const bitrate = getQualityBitrateLabel(opt.value, currentMedia);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        className={`settings-quality-option ${isSelected ? "settings-quality-option--active" : ""}`}
                        onClick={() => { onChangeQuality(opt.value); }}
                      >
                        <div className="settings-quality-info">
                          <span className="settings-quality-name">{opt.label}</span>
                          {bitrate && <span className="settings-quality-bitrate">{bitrate}</span>}
                        </div>
                        <span className="settings-quality-badge">{opt.badge}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── EQ ── */}
            {activeTab === "eq" && (
              <div className="settings-section">
                <div className="settings-section-header">
                  <FontAwesomeIcon icon={faSliders} />
                  <span>Equalizer</span>
                  <label className="eq-toggle" title={eqEnabled ? "Disable EQ" : "Enable EQ"}>
                    <input
                      type="checkbox"
                      className="eq-toggle-input"
                      checked={eqEnabled}
                      onChange={(e) => onSetEqEnabled(e.target.checked)}
                      aria-label="Enable equalizer"
                    />
                    <span className="eq-toggle-track" aria-hidden="true">
                      <span className="eq-toggle-thumb" />
                    </span>
                  </label>
                </div>

                {/* Presets */}
                <div className="eq-presets">
                  {Object.entries(EQ_PRESETS).map(([key, { label }]) => (
                    <button
                      key={key}
                      type="button"
                      className={`eq-preset-btn ${eqPreset === key ? "eq-preset-btn--active" : ""}`}
                      onClick={() => { onSetEqPreset(key); if (!eqEnabled) onSetEqEnabled(true); }}
                    >
                      {label}
                    </button>
                  ))}
                  {eqPreset === "custom" && (
                    <button type="button" className="eq-preset-btn eq-preset-btn--custom eq-preset-btn--active" disabled>
                      Custom
                    </button>
                  )}
                </div>

                {/* Sliders */}
                <div className={`eq-bands ${!eqEnabled ? "eq-bands--disabled" : ""}`}>
                  {EQ_BANDS.map((band, i) => (
                    <div key={band.id} className="eq-band">
                      <span className="eq-band-gain">
                        {gains[i] >= 0 ? `+${gains[i].toFixed(1)}` : gains[i].toFixed(1)}
                      </span>
                      <input
                        type="range"
                        className="eq-slider"
                        orient="vertical"
                        min={GAIN_MIN}
                        max={GAIN_MAX}
                        step={0.5}
                        value={gains[i]}
                        disabled={!eqEnabled}
                        aria-label={`${band.label} gain`}
                        onChange={(e) => { onSetGain(i, Number(e.target.value)); if (!eqEnabled) onSetEqEnabled(true); }}
                      />
                      <span className="eq-band-label">{band.label}</span>
                      <span className="eq-band-freq">
                        {band.frequency >= 1000 ? `${band.frequency / 1000}k` : `${band.frequency}`}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Reset */}
                <button
                  type="button"
                  className="eq-reset-btn"
                  onClick={() => { onSetEqPreset("flat"); if (!eqEnabled) onSetEqEnabled(true); }}
                >
                  Reset
                </button>
              </div>
            )}

            {/* ── Speed ── */}
            {activeTab === "speed" && showSpeed && (
              <div className="settings-section">
                <div className="settings-section-header">
                  <FontAwesomeIcon icon={faBolt} />
                  <span>Playback Speed</span>
                </div>
                <div className="settings-speed-options">
                  {PLAYBACK_RATES.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      className={`settings-speed-option ${playbackRate === rate ? "settings-speed-option--active" : ""}`}
                      onClick={() => { onSelectRate(rate); }}
                    >
                      {rate === 1 ? "Normal" : `${rate}×`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Sleep Timer ── */}
            {activeTab === "timer" && (
              <div className="settings-section">
                <div className="settings-section-header">
                  <FontAwesomeIcon icon={faAlarmClock} />
                  <span>Sleep Timer</span>
                  {timerActive && (
                    <span className="settings-section-badge settings-section-badge--timer">
                      {sleepTimerMode === "media"
                        ? "This media"
                        : sleepTimerMode === "playlist"
                          ? "Playlist"
                          : formatSleepTimer(sleepTimerRemaining)}
                    </span>
                  )}
                </div>
                <div className="settings-timer-boundaries">
                  <button
                    type="button"
                    className={`settings-timer-option settings-timer-option--boundary ${sleepTimerMode === "media" ? "settings-timer-option--active" : ""}`}
                    onClick={() => { onSetSleepTimer("media"); }}
                  >
                    End of this media
                  </button>
                  {hasPlaylist && (
                    <button
                      type="button"
                      className={`settings-timer-option settings-timer-option--boundary ${sleepTimerMode === "playlist" ? "settings-timer-option--active" : ""}`}
                      onClick={() => { onSetSleepTimer("playlist"); }}
                    >
                      End of playlist
                    </button>
                  )}
                </div>
                <div className="settings-timer-presets">
                  {SLEEP_TIMER_PRESETS.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      className="settings-timer-option"
                      onClick={() => { onSetSleepTimer(minutes); }}
                    >
                      {minutes}m
                    </button>
                  ))}
                </div>
                {timerActive && (
                  <button
                    type="button"
                    className="settings-timer-clear"
                    onClick={() => { onSetSleepTimer(0); }}
                  >
                    <FontAwesomeIcon icon={faXmark} />
                    Clear timer
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
