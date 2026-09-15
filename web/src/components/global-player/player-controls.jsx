import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAlarmClock,
  faBackwardStep,
  faForwardStep,
  faInfinity,
  faList,
  faPause,
  faPlay,
  faRepeat,
  faShuffle,
  faSliders,
  faUpRightFromSquare,
  faVolumeHigh,
  faVolumeLow,
  faVolumeXmark,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { getLoopButtonTitle } from "./player-utils";

const SLEEP_TIMER_PRESETS = [5, 15, 30, 45, 60];
const QUALITY_OPTIONS = [
  { value: "ori", label: "Original", badge: "ORI" },
  { value: "high", label: "High", badge: "HD" },
  { value: "med", label: "Medium", badge: "MED" },
  { value: "low", label: "Low", badge: "LOW" },
];

function LoopIcon({ mode }) {
  return (
    <span className="player-loop-icon">
      <FontAwesomeIcon icon={faRepeat} />
      {mode === "queue" && (
        <span className="player-loop-badge" aria-hidden="true">
          <FontAwesomeIcon icon={faInfinity} />
        </span>
      )}
      {mode === "media" && <span className="player-loop-badge" aria-hidden="true">1</span>}
    </span>
  );
}

export function PlayerModeControls({ loopMode, queueOpen, shuffleEnabled, onOpenQueue, onToggleLoop, onToggleShuffle }) {
  return (
    <>
      <button type="button" className={`player-ghost-button ${shuffleEnabled ? "text-[var(--primary)]" : "text-muted"}`} aria-label="Shuffle" aria-pressed={shuffleEnabled} onClick={onToggleShuffle} title="Shuffle">
        <FontAwesomeIcon icon={faShuffle} />
      </button>
      <button type="button" className={`player-ghost-button ${loopMode !== "none" ? "text-[var(--primary)]" : "text-muted"}`} aria-label={getLoopButtonTitle(loopMode)} aria-pressed={loopMode !== "none"} onClick={onToggleLoop} title={getLoopButtonTitle(loopMode)}>
        <LoopIcon mode={loopMode} />
      </button>
      {onOpenQueue && (
        <button type="button" className={`player-ghost-button ${queueOpen ? "text-[var(--primary)]" : "text-muted"}`} aria-label="Queue" aria-pressed={queueOpen} onClick={onOpenQueue} title="Queue">
          <FontAwesomeIcon icon={faList} />
        </button>
      )}
    </>
  );
}

export function QueueButton({ active, onClick }) {
  return (
    <button type="button" className={`player-ghost-button ${active ? "text-[var(--primary)]" : "text-muted"}`} aria-label="Queue" aria-pressed={active} onClick={onClick} title="Queue">
      <FontAwesomeIcon icon={faList} />
    </button>
  );
}

function formatSleepTimer(seconds) {
  if (!seconds) return "Sleep timer";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0
    ? `${minutes}:${String(remainingSeconds).padStart(2, "0")}`
    : `0:${String(remainingSeconds).padStart(2, "0")}`;
}

export function SleepTimerControl({ remainingSeconds = 0, onSetSleepTimer }) {
  const active = remainingSeconds > 0;
  const label = active ? `Sleep timer ${formatSleepTimer(remainingSeconds)} remaining` : "Sleep timer";

  return (
    <div className={active ? "player-sleep-control player-sleep-control--active" : "player-sleep-control"}>
      <button
        type="button"
        className="player-ghost-button"
        aria-label={label}
        aria-pressed={active}
        title={label}
      >
        <FontAwesomeIcon icon={faAlarmClock} />
        {active && <span className="player-sleep-badge">{formatSleepTimer(remainingSeconds)}</span>}
      </button>
      <div className="player-sleep-popover" aria-label="Sleep timer options">
        <div className="player-sleep-presets">
          {SLEEP_TIMER_PRESETS.map((minutes) => (
            <button
              type="button"
              key={minutes}
              className="player-sleep-preset"
              onClick={() => onSetSleepTimer(minutes)}
            >
              {minutes}m
            </button>
          ))}
        </div>
        <button
          type="button"
          className="player-sleep-clear"
          onClick={() => onSetSleepTimer(0)}
          disabled={!active}
          title="Clear sleep timer"
          aria-label="Clear sleep timer"
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
    </div>
  );
}

export function formatBitrate(bps) {
  if (!bps || typeof bps !== "number") return null;
  if (bps >= 1_000_000) {
    const mbps = (bps / 1_000_000).toFixed(1);
    return `${mbps.endsWith(".0") ? mbps.slice(0, -2) : mbps} Mbps`;
  }
  return `${Math.round(bps / 1000)} kbps`;
}

export function getQualityBitrateLabel(optValue, currentMedia) {
  const mime = currentMedia?.mime_type || "";
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");

  const variant = currentMedia?.encoding_status?.[optValue];
  if (variant?.bitrate) {
    const formatted = formatBitrate(variant.bitrate);
    if (isVideo && variant.height) {
      return `${variant.height}p • ${formatted}`;
    }
    return formatted;
  }

  if (isVideo) {
    if (optValue === "high") return "1080p • ~5 Mbps";
    if (optValue === "med") return "720p • ~2.5 Mbps";
    if (optValue === "low") return "480p • ~1 Mbps";
    if (optValue === "ori") return "Original";
  }

  if (isAudio) {
    if (optValue === "high") return "256 kbps";
    if (optValue === "med") return "160 kbps";
    if (optValue === "low") return "96 kbps";
    if (optValue === "ori") return "Source";
  }

  return null;
}

export function QualityControl({ currentMedia, quality = "ori", actualQuality, onChangeQuality, variant = "ghost" }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const activeOption = QUALITY_OPTIONS.find((opt) => opt.value === quality) || QUALITY_OPTIONS[0];
  const isModified = quality !== "ori";
  const activeBitrate = getQualityBitrateLabel(actualQuality || quality, currentMedia);
  const title = `Quality: ${activeOption.label}${activeBitrate ? ` (${activeBitrate})` : ""}${actualQuality && actualQuality !== quality ? ` (Playing ${actualQuality})` : ""}`;

  const buttonClass = variant === "fullscreen"
    ? `fullscreen-player-icon-button ${isModified ? "fullscreen-player-icon-button--active" : ""}`
    : `player-ghost-button ${isModified ? "text-[var(--primary)]" : "text-muted"}`;

  return (
    <div
      ref={containerRef}
      className={`player-quality-control ${variant === "fullscreen" ? "player-quality-control--fullscreen" : ""} ${open ? "player-quality-control--open" : ""}`}
    >
      <button
        type="button"
        className={buttonClass}
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={title}
        onClick={() => setOpen((prev) => !prev)}
      >
        <FontAwesomeIcon icon={faSliders} />
        <span className="player-quality-badge">{activeOption.badge}</span>
      </button>

      <div className="player-quality-popover" role="listbox" aria-label="Media quality options">
        <div className="player-quality-header">
          <span>Quality</span>
          {activeBitrate && (
            <span className="player-quality-bitrate-active">{activeBitrate}</span>
          )}
          {actualQuality && actualQuality !== quality && (
            <span className="player-quality-fallback">→ {actualQuality.toUpperCase()}</span>
          )}
        </div>
        <div className="player-quality-presets">
          {QUALITY_OPTIONS.map((opt) => {
            const isSelected = opt.value === quality;
            const bitrateLabel = getQualityBitrateLabel(opt.value, currentMedia);
            return (
              <button
                type="button"
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                className={`player-quality-preset ${isSelected ? "player-quality-preset--active" : ""}`}
                onClick={() => {
                  onChangeQuality(opt.value);
                  setOpen(false);
                }}
              >
                <div className="player-quality-preset-info">
                  <span className="player-quality-preset-name">{opt.label}</span>
                  {bitrateLabel && (
                    <span className="player-quality-preset-bitrate">{bitrateLabel}</span>
                  )}
                </div>
                <span className="player-quality-preset-tag">{opt.badge}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getVolumeIcon(volume, muted) {
  if (muted || volume <= 0) return faVolumeXmark;
  return volume < 0.5 ? faVolumeLow : faVolumeHigh;
}

export function VolumeControl({ isImage, muted, volume, onChangeVolume, onToggleMute }) {
  if (isImage) return null;

  const volumePercent = Math.round(volume * 100);
  const effectivePercent = muted ? 0 : volumePercent;

  return (
    <div
      className={muted || volume <= 0 ? "player-volume-control player-volume-control--muted" : "player-volume-control"}
      style={{ "--player-volume-percent": `${effectivePercent}%` }}
    >
      <button
        type="button"
        className="player-volume-button"
        aria-label={muted || volume <= 0 ? "Unmute" : "Mute"}
        aria-pressed={muted || volume <= 0}
        onClick={onToggleMute}
        title={muted || volume <= 0 ? "Unmute" : "Mute"}
      >
        <FontAwesomeIcon icon={getVolumeIcon(volume, muted)} />
      </button>
      <div className="player-volume-popover">
        <input
          type="range"
          className="player-volume-range"
          min="0"
          max="100"
          step="1"
          value={volumePercent}
          aria-label="Volume"
          aria-valuetext={muted ? "Muted" : `${volumePercent}%`}
          title={`Volume ${effectivePercent}%`}
          onChange={(event) => onChangeVolume(Number(event.target.value) / 100)}
        />
      </div>
    </div>
  );
}

export function TransportControls({ hasNext, hasPrev, isImage, paused, onAdvance, onToggle }) {
  return (
    <>
      <button type="button" className="player-transport-button" aria-label="Previous" disabled={!hasPrev} onClick={() => onAdvance("prev")} title="Previous">
        <FontAwesomeIcon icon={faBackwardStep} />
      </button>
      <button type="button" className="player-play-button" aria-label={isImage ? "Open media" : paused ? "Play" : "Pause"} onClick={onToggle} title={paused ? "Play" : "Pause"}>
        <FontAwesomeIcon icon={isImage ? faUpRightFromSquare : paused ? faPlay : faPause} />
      </button>
      <button type="button" className="player-transport-button" aria-label="Next" disabled={!hasNext} onClick={() => onAdvance("next")} title="Next">
        <FontAwesomeIcon icon={faForwardStep} />
      </button>
    </>
  );
}
