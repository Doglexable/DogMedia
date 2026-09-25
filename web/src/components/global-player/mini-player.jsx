import { useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRotateRight } from "@fortawesome/free-solid-svg-icons/faArrowRotateRight";
import { faExpand } from "@fortawesome/free-solid-svg-icons/faExpand";
import { faFilm } from "@fortawesome/free-solid-svg-icons/faFilm";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons/faRotateLeft";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { PlayerBar } from "./player-bar";
import { formatDuration, getMediaFolderName } from "./player-utils";

function VideoMiniPlayer({
  currentMedia,
  duration = 0,
  position = 0,
  paused = true,
  thumbSrc,
  onToggle,
  onSeek,
  onOpenFull,
  onClose,
  quality,
}) {
  const [thumbError, setThumbError] = useState(false);
  const progressBarRef = useRef(null);

  const folderName = getMediaFolderName(currentMedia);
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

  const handleScrubberClick = (e) => {
    if (!duration || !onSeek || !progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    onSeek(ratio * duration);
  };

  const handleScrubberKeyDown = (e) => {
    if (!duration || !onSeek) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(Math.max(0, position - 5));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(duration, position + 5));
    }
  };

  return (
    <aside
      className="video-mini-player"
      role="region"
      aria-label={`Mini player: ${currentMedia?.title || "Video"}`}
    >
      {/* ── 16:9 Video Preview / Thumbnail ── */}
      <div
        className="video-mini-preview group/preview"
        onClick={onOpenFull}
      >
        {thumbSrc && !thumbError ? (
          <img
            src={thumbSrc}
            alt={currentMedia?.title || "Video thumbnail"}
            className="video-mini-thumb"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-neutral-900 via-neutral-950 to-black text-white/40">
            <FontAwesomeIcon icon={faFilm} className="text-3xl" />
          </div>
        )}

        <div className="video-mini-scrim" />

        {/* Top actions (Expand & Close) */}
        <div className="video-mini-top-actions">
          <button
            type="button"
            className="video-mini-top-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFull?.();
            }}
            aria-label="Expand to fullscreen"
            title="Expand to fullscreen"
          >
            <FontAwesomeIcon icon={faExpand} className="text-xs" />
          </button>
          {onClose && (
            <button
              type="button"
              className="video-mini-top-btn"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label="Close video player"
              title="Close"
            >
              <FontAwesomeIcon icon={faXmark} className="text-xs" />
            </button>
          )}
        </div>

        {/* Bottom preview overlay: Timestamp and quality badge */}
        <div className="video-mini-bottom-overlay">
          <span className="video-mini-time-tag">
            {formatDuration(position)} / {formatDuration(duration)}
          </span>
          {quality && quality !== "ori" && (
            <span className="video-mini-badge uppercase">{quality}</span>
          )}
        </div>
      </div>

      {/* ── Interactive Scrubber ── */}
      <div
        ref={progressBarRef}
        className="video-mini-scrubber group/scrubber"
        onClick={handleScrubberClick}
        onKeyDown={handleScrubberKeyDown}
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${formatDuration(position)} of ${formatDuration(duration)}`}
        tabIndex={0}
      >
        <div
          className="video-mini-scrubber-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* ── Bottom Metadata & Control Strip ── */}
      <div className="video-mini-meta-strip">
        <div
          className="video-mini-info"
          onClick={onOpenFull}
          title={currentMedia?.title}
        >
          <div className="video-mini-title">
            {currentMedia?.title || "Video"}
          </div>
          <div className="video-mini-subtitle">
            {folderName}
          </div>
        </div>

        <div className="video-mini-actions">
          {/* Rewind 10s */}
          <button
            type="button"
            className="video-mini-btn"
            onClick={() => onSeek?.(Math.max(0, position - 10))}
            aria-label="Rewind 10 seconds"
            title="Rewind 10s"
          >
            <FontAwesomeIcon icon={faRotateLeft} className="text-xs" />
          </button>

          {/* Play/Pause */}
          <button
            type="button"
            className="video-mini-play-btn"
            onClick={onToggle}
            aria-label={paused ? "Play" : "Pause"}
            title={paused ? "Play" : "Pause"}
          >
            <FontAwesomeIcon
              icon={paused ? faPlay : faPause}
              className={paused ? "ml-0.5 text-sm" : "text-sm"}
            />
          </button>

          {/* Forward 10s */}
          <button
            type="button"
            className="video-mini-btn"
            onClick={() => onSeek?.(Math.min(duration, position + 10))}
            aria-label="Forward 10 seconds"
            title="Forward 10s"
          >
            <FontAwesomeIcon icon={faArrowRotateRight} className="text-xs" />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function MiniPlayer(props) {
  const { currentMedia } = props;
  if (!currentMedia) return null;

  const isAudio = Boolean(currentMedia.mime_type?.startsWith("audio/"));
  const isVideo = Boolean(currentMedia.mime_type?.startsWith("video/"));

  if (isAudio) {
    return <PlayerBar isMini {...props} />;
  }

  if (isVideo) {
    return <VideoMiniPlayer {...props} />;
  }

  return null;
}
