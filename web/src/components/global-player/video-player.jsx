import { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRotateLeft } from "@fortawesome/free-solid-svg-icons/faArrowRotateLeft";
import { faArrowRotateRight } from "@fortawesome/free-solid-svg-icons/faArrowRotateRight";
import { faBackwardStep } from "@fortawesome/free-solid-svg-icons/faBackwardStep";
import { faBookmark } from "@fortawesome/free-solid-svg-icons/faBookmark";
import { faClone } from "@fortawesome/free-solid-svg-icons/faClone";
import { faCompress } from "@fortawesome/free-solid-svg-icons/faCompress";
import { faExpand } from "@fortawesome/free-solid-svg-icons/faExpand";
import { faForwardStep } from "@fortawesome/free-solid-svg-icons/faForwardStep";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faRotateLeft } from "@fortawesome/free-solid-svg-icons/faRotateLeft";
import { faVolumeHigh } from "@fortawesome/free-solid-svg-icons/faVolumeHigh";
import { faVolumeLow } from "@fortawesome/free-solid-svg-icons/faVolumeLow";
import { faVolumeXmark } from "@fortawesome/free-solid-svg-icons/faVolumeXmark";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { ShinyText } from "../ShinyText";
import { SettingsControl } from "./settings-panel";
import { formatDuration } from "./player-utils";

function getVolumeIcon(volume, muted) {
  if (muted || volume <= 0) return faVolumeXmark;
  return volume < 0.5 ? faVolumeLow : faVolumeHigh;
}

export function VideoPlayer({
  autoPlay,
  currentMedia,
  duration,
  hasNext,
  hasPrev,
  liked,
  mediaRef,
  muted,
  paused,
  position,
  resumePos,
  sleepTimerRemaining,
  sleepTimerMode,
  hasPlaylist,
  streamSrc,
  volume,
  quality,
  actualQuality,
  onChangeQuality,
  onAdvance,
  onChangeVolume,
  onEnded,
  onLoadedMetadata,
  onCloseFull,
  onPause,
  onPlay,
  onPreventMenu,
  onResume,
  onSeek,
  onTimeUpdate,
  onToggleMute,
  onToggle,
  onToggleLike,
  onSetSleepTimer,
  eqGains,
  eqPreset,
  eqEnabled,
  onSetEqGain,
  onSetEqPreset,
  onSetEqEnabled,
}) {
  const rootRef = useRef(null);
  const cardRef = useRef(null);
  const scrubberRef = useRef(null);
  const hideHudTimeoutRef = useRef(null);
  const clickTimeoutRef = useRef(null);
  const toastTimeoutRef = useRef(null);

  const [showHud, setShowHud] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [canPip, setCanPip] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverPercent, setHoverPercent] = useState(null);
  const [toast, setToast] = useState(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const mediaDuration = duration || currentMedia?.duration || 0;
  const max = Math.max(mediaDuration, position, 1);
  const playedPercent = Math.min(Math.max((position / max) * 100, 0), 100);
  const volumePercent = Math.round((muted ? 0 : volume) * 100);
  const showFeedbackToast = useCallback((msg, icon = null) => {
    setToast({ message: msg, icon });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 1200);
  }, []);

  // Sync fullscreen state
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Sync picture-in-picture state
  useEffect(() => {
    const videoEl = mediaRef.current;
    if (!videoEl) return;
    if (document.pictureInPictureEnabled && typeof videoEl.requestPictureInPicture === "function") {
      setCanPip(true);
    }
    const handleEnterPip = () => setIsPip(true);
    const handleLeavePip = () => setIsPip(false);
    videoEl.addEventListener("enterpictureinpicture", handleEnterPip);
    videoEl.addEventListener("leavepictureinpicture", handleLeavePip);
    return () => {
      videoEl.removeEventListener("enterpictureinpicture", handleEnterPip);
      videoEl.removeEventListener("leavepictureinpicture", handleLeavePip);
    };
  }, [mediaRef]);

  // Auto-hide HUD when mouse is inactive and video is playing
  const resetHudTimer = useCallback(() => {
    setShowHud(true);
    if (hideHudTimeoutRef.current) clearTimeout(hideHudTimeoutRef.current);
    if (!paused) {
      hideHudTimeoutRef.current = setTimeout(() => {
        if (!isScrubbing) {
          setShowHud(false);
        }
      }, 2500);
    }
  }, [paused, isScrubbing]);

  useEffect(() => {
    if (paused) {
      setShowHud(true);
      if (hideHudTimeoutRef.current) clearTimeout(hideHudTimeoutRef.current);
    } else {
      resetHudTimer();
    }
  }, [paused, resetHudTimer]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        if (rootRef.current?.requestFullscreen) {
          await rootRef.current.requestFullscreen();
          showFeedbackToast("Fullscreen", faExpand);
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
          showFeedbackToast("Exit Fullscreen", faCompress);
        }
      }
    } catch {
      // Ignored
    }
  }, [showFeedbackToast]);

  // Picture in picture toggle
  const togglePip = useCallback(async () => {
    try {
      if (!document.pictureInPictureElement) {
        if (mediaRef.current?.requestPictureInPicture) {
          await mediaRef.current.requestPictureInPicture();
          showFeedbackToast("Picture in Picture", faClone);
        }
      } else {
        if (document.exitPictureInPicture) {
          await document.exitPictureInPicture();
        }
      }
    } catch {
      // Ignored
    }
  }, [mediaRef, showFeedbackToast]);

  // Playback speed
  const handleSelectRate = useCallback((rate) => {
    if (mediaRef.current) {
      mediaRef.current.playbackRate = rate;
    }
    setPlaybackRate(rate);
    showFeedbackToast(`Speed ${rate}x`);
  }, [mediaRef, showFeedbackToast]);

  // Skip time helper
  const handleSkipSeconds = useCallback((delta) => {
    const nextTime = Math.min(Math.max(position + delta, 0), max);
    onSeek(nextTime);
    showFeedbackToast(delta > 0 ? `+${delta}s` : `${delta}s`, delta > 0 ? faArrowRotateRight : faArrowRotateLeft);
  }, [max, onSeek, position, showFeedbackToast]);

  // Scrubber hover & seek
  const calculateScrubTime = useCallback((e) => {
    if (!scrubberRef.current) return 0;
    const rect = scrubberRef.current.getBoundingClientRect();
    const percent = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    return { time: percent * max, percent: percent * 100 };
  }, [max]);

  const handleScrubberMouseMove = (e) => {
    const { time, percent } = calculateScrubTime(e);
    setHoverTime(time);
    setHoverPercent(percent);
    if (isScrubbing) {
      onSeek(time);
    }
  };

  const handleScrubberMouseDown = (e) => {
    setIsScrubbing(true);
    const { time } = calculateScrubTime(e);
    onSeek(time);
    const handleMouseUp = () => {
      setIsScrubbing(false);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Video stage click & double-click interactions
  const handleStageClick = (e) => {
    if (e.target.closest("button, input, a, [role='slider'], [role='menu'], [role='menuitem'], [role='listbox'], [role='option']")) return;

    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      // Double click!
      if (!cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      const relativeX = (e.clientX - rect.left) / rect.width;
      if (relativeX < 0.28) {
        handleSkipSeconds(-10);
      } else if (relativeX > 0.72) {
        handleSkipSeconds(10);
      } else {
        toggleFullscreen();
      }
    } else {
      clickTimeoutRef.current = setTimeout(() => {
        onToggle();
        clickTimeoutRef.current = null;
      }, 220);
    }
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.defaultPrevented) return;
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;

      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault();
          onToggle();
          break;
        case "arrowleft":
        case "j":
          e.preventDefault();
          handleSkipSeconds(e.shiftKey ? -10 : -5);
          break;
        case "arrowright":
        case "l":
          e.preventDefault();
          handleSkipSeconds(e.shiftKey ? 10 : 5);
          break;
        case "arrowup":
          e.preventDefault();
          onChangeVolume(Math.min(volume + 0.1, 1));
          showFeedbackToast(`Volume ${Math.round(Math.min(volume + 0.1, 1) * 100)}%`, faVolumeHigh);
          break;
        case "arrowdown":
          e.preventDefault();
          onChangeVolume(Math.max(volume - 0.1, 0));
          showFeedbackToast(`Volume ${Math.round(Math.max(volume - 0.1, 0) * 100)}%`, faVolumeLow);
          break;
        case "m":
          e.preventDefault();
          onToggleMute();
          showFeedbackToast(muted ? "Unmuted" : "Muted", muted ? faVolumeHigh : faVolumeXmark);
          break;
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "escape":
          if (!document.fullscreenElement) {
            e.preventDefault();
            onCloseFull?.();
          }
          break;
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9":
          e.preventDefault();
          onSeek((Number(e.key) / 10) * max);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleSkipSeconds,
    max,
    muted,
    onChangeVolume,
    onCloseFull,
    onSeek,
    onToggle,
    onToggleMute,
    showFeedbackToast,
    toggleFullscreen,
    volume,
  ]);

  return (
    <div
      ref={rootRef}
      className={`video-player-root ${!showHud && !paused ? "video-player-root--hide-cursor" : ""}`}
      onMouseMove={resetHudTimer}
      onContextMenu={onPreventMenu}
      onClick={handleStageClick}
    >
      {/* Ambient Glow Backdrop */}
      <div className="video-player-ambient-glow" aria-hidden="true" />

      {/* Fullscreen Video Canvas Stage */}
      <div
        ref={cardRef}
        className="video-player-stage"
      >
        {/* HTML5 Video Element - Full Viewport Coverage */}
        <video
          ref={mediaRef}
          src={streamSrc}
          controls={false}
          controlsList="nodownload noplaybackrate"
          disableRemotePlayback
          preload="metadata"
          autoPlay={autoPlay}
          muted={muted || volume <= 0}
          className="video-player-video"
          onContextMenu={onPreventMenu}
          onPlay={onPlay}
          onPause={onPause}
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          onEnded={onEnded}
        />

        {/* Floating Feedback Toast */}
        {toast && (
          <div className="video-player-feedback-toast" role="status">
            {toast.icon && <FontAwesomeIcon icon={toast.icon} />}
            <span>{toast.message}</span>
          </div>
        )}

        {/* Fullscreen On-Screen HUD Overlay */}
        <div className={`video-player-hud ${showHud ? "video-player-hud--visible" : ""}`}>
          <div className="video-player-hud-scrim-top" />
          <div className="video-player-hud-scrim-bottom" />

          {/* Top HUD Bar */}
          <div className="video-player-hud-top" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3.5 min-w-0">
              <button
                type="button"
                className="video-player-btn-icon"
                aria-label="Close fullscreen player"
                title="Close (Esc)"
                onClick={onCloseFull}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>

              <h1 className="text-base font-bold text-white drop-shadow truncate max-w-2xl" title={currentMedia?.title}>
                <ShinyText text={currentMedia?.title || "Video"} speed={4} />
              </h1>
            </div>
          </div>

          {/* Center Play/Pause Button */}
          <div className="video-player-hud-center">
            <button
              type="button"
              className="video-player-center-btn"
              aria-label={paused ? "Play" : "Pause"}
              title={paused ? "Play (Space)" : "Pause (Space)"}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              <FontAwesomeIcon icon={paused ? faPlay : faPause} />
            </button>
          </div>

          {/* Bottom HUD Bar */}
          <div className="video-player-hud-bottom" onClick={(e) => e.stopPropagation()}>
            {/* Scrubber */}
            <div
              ref={scrubberRef}
              className="video-player-scrubber-wrap"
              onMouseMove={handleScrubberMouseMove}
              onMouseLeave={() => {
                setHoverTime(null);
                setHoverPercent(null);
              }}
              onMouseDown={handleScrubberMouseDown}
              role="slider"
              aria-label="Seek slider"
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={position}
              aria-valuetext={formatDuration(position)}
            >
              <div className="video-player-scrubber-track">
                <div
                  className="video-player-scrubber-played"
                  style={{ width: `${playedPercent}%` }}
                />
                <div
                  className="video-player-scrubber-thumb"
                  style={{ left: `${playedPercent}%` }}
                />
              </div>

              {hoverTime !== null && hoverPercent !== null && (
                <div
                  className="video-player-scrubber-tooltip"
                  style={{ left: `${hoverPercent}%` }}
                >
                  {formatDuration(hoverTime)}
                </div>
              )}
            </div>

            {/* Controls Bar Row */}
            <div className="video-player-controls-row">
              {/* Left Controls */}
              <div className="video-player-controls-group">
                <button
                  type="button"
                  className="video-player-ctrl-btn video-player-ctrl-btn--primary"
                  aria-label={paused ? "Play" : "Pause"}
                  aria-keyshortcuts="Space"
                  title={paused ? "Play (Space)" : "Pause (Space)"}
                  onClick={onToggle}
                >
                  <FontAwesomeIcon icon={paused ? faPlay : faPause} />
                </button>

                <button
                  type="button"
                  className="video-player-ctrl-btn"
                  aria-label="Previous"
                  disabled={!hasPrev}
                  title="Previous video"
                  onClick={() => onAdvance?.("prev")}
                >
                  <FontAwesomeIcon icon={faBackwardStep} />
                </button>

                <button
                  type="button"
                  className="video-player-ctrl-btn"
                  aria-label="Rewind 10 seconds"
                  title="Rewind 10s (Left Arrow)"
                  onClick={() => handleSkipSeconds(-10)}
                >
                  <FontAwesomeIcon icon={faArrowRotateLeft} />
                </button>

                <button
                  type="button"
                  className="video-player-ctrl-btn"
                  aria-label="Forward 10 seconds"
                  title="Forward 10s (Right Arrow)"
                  onClick={() => handleSkipSeconds(10)}
                >
                  <FontAwesomeIcon icon={faArrowRotateRight} />
                </button>

                <button
                  type="button"
                  className="video-player-ctrl-btn"
                  aria-label="Next"
                  disabled={!hasNext}
                  title="Next video"
                  onClick={() => onAdvance?.("next")}
                >
                  <FontAwesomeIcon icon={faForwardStep} />
                </button>

                {/* Volume Slider */}
                <div className="video-player-volume-group">
                  <button
                    type="button"
                    className="video-player-ctrl-btn"
                    aria-label={muted || volume <= 0 ? "Unmute (M)" : "Mute (M)"}
                    title={muted || volume <= 0 ? "Unmute (M)" : "Mute (M)"}
                    onClick={onToggleMute}
                  >
                    <FontAwesomeIcon icon={getVolumeIcon(volume, muted)} />
                  </button>
                  <div className="video-player-volume-slider-wrap">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={volumePercent}
                      aria-label="Volume"
                      aria-valuetext={muted ? "Muted" : `${volumePercent}%`}
                      title={`Volume ${volumePercent}%`}
                      onChange={(e) => onChangeVolume(Number(e.target.value) / 100)}
                      className="video-player-volume-range"
                    />
                  </div>
                </div>

                {/* Timestamps */}
                <div className="video-player-time-display">
                  <span>{formatDuration(position)}</span>
                  <span className="opacity-50 mx-1">/</span>
                  <span className="opacity-75">{formatDuration(max)}</span>
                </div>
              </div>

              {/* Right Controls */}
              <div className="video-player-controls-group">
                {/* Unified Settings — Quality / EQ / Speed / Timer */}
                <SettingsControl
                  variant="video-ctrl"
                  showSpeed
                  currentMedia={currentMedia}
                  quality={quality}
                  actualQuality={actualQuality}
                  onChangeQuality={onChangeQuality}
                  gains={eqGains}
                  eqPreset={eqPreset}
                  eqEnabled={eqEnabled}
                  onSetGain={onSetEqGain}
                  onSetEqPreset={onSetEqPreset}
                  onSetEqEnabled={onSetEqEnabled}
                  playbackRate={playbackRate}
                  onSelectRate={handleSelectRate}
                  sleepTimerRemaining={sleepTimerRemaining}
                  sleepTimerMode={sleepTimerMode}
                  hasPlaylist={hasPlaylist}
                  onSetSleepTimer={onSetSleepTimer}
                />

                {/* Favorite */}
                <button
                  type="button"
                  className={`video-player-ctrl-btn ${liked ? "video-player-ctrl-btn--active" : ""}`}
                  aria-label={liked ? "Remove from favorites" : "Add to favorites"}
                  title={liked ? "Remove from favorites" : "Add to favorites"}
                  onClick={onToggleLike}
                >
                  <FontAwesomeIcon icon={faBookmark} />
                </button>

                {/* Picture in Picture */}
                {canPip && (
                  <button
                    type="button"
                    className={`video-player-ctrl-btn ${isPip ? "video-player-ctrl-btn--active" : ""}`}
                    aria-label="Picture in picture"
                    title="Picture in Picture"
                    onClick={togglePip}
                  >
                    <FontAwesomeIcon icon={faClone} />
                  </button>
                )}

                {/* Fullscreen Button */}
                <button
                  type="button"
                  className="video-player-ctrl-btn"
                  aria-label={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
                  title={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
                  onClick={toggleFullscreen}
                >
                  <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Resume Playback Prompt Banner */}
      {resumePos !== null && (
        <div className="fixed left-1/2 bottom-20 -translate-x-1/2 z-50">
          <button
            type="button"
            onClick={onResume}
            className="px-5 py-2.5 rounded-full bg-rose-600/90 hover:bg-rose-500 text-white font-bold text-sm shadow-xl backdrop-blur-md flex items-center gap-2 transition-transform hover:scale-105"
          >
            <FontAwesomeIcon icon={faRotateLeft} />
            Resume from {formatDuration(resumePos)}
          </button>
        </div>
      )}
    </div>
  );
}

export default VideoPlayer;
