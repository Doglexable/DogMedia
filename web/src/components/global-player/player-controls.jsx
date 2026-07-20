import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBackwardStep,
  faForwardStep,
  faList,
  faPause,
  faPlay,
  faRepeat,
  faShuffle,
  faUpRightFromSquare,
  faVolumeHigh,
  faVolumeLow,
  faVolumeXmark,
} from "@fortawesome/free-solid-svg-icons";
import { getLoopButtonTitle } from "./player-utils";

function LoopIcon({ mode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <FontAwesomeIcon icon={faRepeat} />
      {mode === "queue" && <span className="text-[10px] font-black">Q</span>}
      {mode === "media" && <span className="text-[10px] font-black">1</span>}
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
