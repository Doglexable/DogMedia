import { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBackwardStep } from "@fortawesome/free-solid-svg-icons/faBackwardStep";
import { faBookmark } from "@fortawesome/free-solid-svg-icons/faBookmark";
import { faForwardStep } from "@fortawesome/free-solid-svg-icons/faForwardStep";
import { faInfinity } from "@fortawesome/free-solid-svg-icons/faInfinity";
import { faList } from "@fortawesome/free-solid-svg-icons/faList";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { faQuoteRight } from "@fortawesome/free-solid-svg-icons/faQuoteRight";
import { faRepeat } from "@fortawesome/free-solid-svg-icons/faRepeat";
import { faShuffle } from "@fortawesome/free-solid-svg-icons/faShuffle";
import { faShareNodes } from "@fortawesome/free-solid-svg-icons/faShareNodes";
import { faVolumeHigh } from "@fortawesome/free-solid-svg-icons/faVolumeHigh";
import { faVolumeLow } from "@fortawesome/free-solid-svg-icons/faVolumeLow";
import { faVolumeXmark } from "@fortawesome/free-solid-svg-icons/faVolumeXmark";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { PlayerBar } from "./player-bar";
import { SettingsControl } from "./settings-panel";
import { FullscreenLyrics } from "./lyrics-panel";
import { AudioShareDialog } from "./audio-share-dialog";
import { resolveMediaArtist } from "./media-artists";
import { VideoPlayer } from "./video-player";
import { SpotifyConnectBar } from "./spotify-connect-bar";
import { playerStyles as styles } from "./player-styles";
import { formatDuration, getLoopButtonTitle, getMediaFolderName, isEditableTarget } from "./player-utils";
import { mediaViewTransitionName, runViewTransition } from "../../utils/view-transitions";
import { api } from "../../api";

const PLAYER_LYRICS_VISIBLE_KEY = "pfs:player-lyrics-visible";

function readStoredLyricsVisibility() {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PLAYER_LYRICS_VISIBLE_KEY) !== "false";
  } catch {
    return true;
  }
}

function storeLyricsVisibility(visible) {
  try {
    window.localStorage.setItem(PLAYER_LYRICS_VISIBLE_KEY, String(visible));
  } catch {
    // Playback controls should keep working when storage is unavailable.
  }
}

function getVolumeIcon(volume, muted) {
  if (muted || volume <= 0) return faVolumeXmark;
  return volume < 0.5 ? faVolumeLow : faVolumeHigh;
}

function RepeatIcon({ mode }) {
  return (
    <span className="fullscreen-player-loop-icon">
      <FontAwesomeIcon icon={faRepeat} />
      {mode === "queue" && <FontAwesomeIcon icon={faInfinity} className="fullscreen-player-loop-badge" />}
      {mode === "media" && <span className="fullscreen-player-loop-badge">1</span>}
    </span>
  );
}

export function FullPlayer({
  autoPlay, currentMedia, duration, hasNext, hasPrev, isAudio, isImage, isVideo,
  loopMode, mediaRef, meta, muted, paused, position, queueOpen, resumePos,
  shuffleEnabled, sleepTimerRemaining, sleepTimerMode, hasPlaylist, streamSrc, thumbFailed, thumbSrc, volume, onAdvance,
  onChangeVolume, onEnded, onLoadedMetadata, onOpenQueue, onPause, onPlay,
  onPreventMenu, onResume, onSeek, onThumbError, onTimeUpdate, onToggleLoop,
  onToggleMute, onToggleShuffle, onToggle, liked, onToggleLike, onCloseFull,
  onSetSleepTimer,
  quality, actualQuality, onChangeQuality,
  eqGains, eqPreset, eqEnabled, eqTargetDb, onSetEqGain, onSetEqPreset, onSetEqEnabled,
  onSetEqTargetDb, onAdjustEqToTarget,
  lyrics, lyricsLoading,
  conflict, controlsLocked = false, canTakeOver = false, onTakeOver,
}) {
  const [displayedArtworkSrc, setDisplayedArtworkSrc] = useState(thumbSrc);
  const [isArtworkLoaded, setIsArtworkLoaded] = useState(Boolean(thumbSrc) && !thumbFailed);
  const [shadowPalette, setShadowPalette] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [showLyricsMobile, setShowLyricsMobile] = useState(false);
  const [showLyricsDesktop, setShowLyricsDesktop] = useState(readStoredLyricsVisibility);
  const [isSingleColumn, setIsSingleColumn] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 899px)").matches;
  });

  const mediaId = Number(currentMedia?.id);
  const artworkShadowColor = shadowPalette?.mediaId === mediaId && shadowPalette?.thumbSrc === thumbSrc
    ? shadowPalette.hex : null;

  useEffect(() => {
    if (!isAudio || !thumbSrc || !Number.isInteger(mediaId) || mediaId < 1) return undefined;
    const controller = new AbortController();
    api(`/api/media/${mediaId}/artwork-palette`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((palette) => {
        const hex = palette?.colors?.[2]?.hex;
        if (!controller.signal.aborted && /^#[0-9a-f]{6}$/i.test(hex || "")) {
          setShadowPalette({ mediaId, thumbSrc, hex });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [isAudio, mediaId, thumbSrc]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 899px)");
    const onChange = (e) => setIsSingleColumn(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const lyricsMatchCurrentMedia = !lyrics?.mediaId || Number(lyrics.mediaId) === Number(currentMedia?.id);
  const hasLyrics = Boolean(lyricsLoading || (lyricsMatchCurrentMedia && lyrics?.segments?.length > 0));
  const lyricsActive = hasLyrics && (isSingleColumn ? showLyricsMobile : showLyricsDesktop);
  const openShareDialog = useCallback(() => runViewTransition(
    () => setShareOpen(true),
    { className: "modal-view-transition" },
  ), []);
  const closeShareDialog = useCallback(() => runViewTransition(
    () => setShareOpen(false),
    { className: "modal-view-transition" },
  ), []);

  const onToggleLyrics = useCallback(() => {
    if (isSingleColumn) {
      setShowLyricsMobile((prev) => !prev);
    } else {
      setShowLyricsDesktop((prev) => {
        const nextVisible = !prev;
        storeLyricsVisibility(nextVisible);
        return nextVisible;
      });
    }
  }, [isSingleColumn]);

  useEffect(() => {
    if (isVideo) return undefined;

    const handleKeyDown = (e) => {
      if (e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (shareOpen) {
          closeShareDialog();
        } else {
          onCloseFull?.();
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      switch (key) {
        case "l":
          if (hasLyrics) {
            e.preventDefault();
            onToggleLyrics();
          }
          break;
        case "q":
          e.preventDefault();
          onOpenQueue?.();
          break;
        case "s":
          e.preventDefault();
          onToggleShuffle?.();
          break;
        case "r":
          e.preventDefault();
          onToggleLoop?.();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeShareDialog, hasLyrics, isVideo, onCloseFull, onOpenQueue, onToggleLoop, onToggleLyrics, onToggleShuffle, shareOpen]);

  useEffect(() => {
    if (!hasLyrics && showLyricsMobile) {
      setShowLyricsMobile(false);
    }
  }, [hasLyrics, showLyricsMobile]);

  const onThumbErrorRef = useRef(onThumbError);
  onThumbErrorRef.current = onThumbError;

  useEffect(() => {
    if (!thumbSrc || thumbFailed) {
      setDisplayedArtworkSrc("");
      setIsArtworkLoaded(false);
      return;
    }

    if (displayedArtworkSrc === thumbSrc) {
      setIsArtworkLoaded(true);
      return;
    }

    let active = true;
    if (typeof Image !== "undefined") {
      const img = new Image();
      img.src = thumbSrc;
      if (img.complete && img.naturalWidth > 0) {
        setDisplayedArtworkSrc(thumbSrc);
        setIsArtworkLoaded(true);
        return;
      }

      img.onload = () => {
        if (!active) return;
        setDisplayedArtworkSrc(thumbSrc);
        setIsArtworkLoaded(true);
      };
      img.onerror = () => {
        if (!active) return;
        onThumbErrorRef.current?.();
      };
    } else {
      setDisplayedArtworkSrc(thumbSrc);
      setIsArtworkLoaded(true);
    }

    return () => {
      active = false;
    };
  }, [thumbSrc, thumbFailed]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.classList.add("player-expanded");
    document.body.style.overflow = "hidden";
    return () => {
      document.body.classList.remove("player-expanded");
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (isAudio) {
    const album = getMediaFolderName(currentMedia) || "Library";
    const artist = resolveMediaArtist(currentMedia, album);
    const max = Math.max(duration || currentMedia.duration || 0, position, 1);
    const remaining = Math.max((duration || currentMedia.duration || 0) - position, 0);
    const effectiveArtworkSrc = displayedArtworkSrc || thumbSrc;
    const hasArtwork = Boolean(effectiveArtworkSrc) && !thumbFailed;
    const volumePercent = Math.round(volume * 100);
    const effectiveVolume = muted ? 0 : volumePercent;

    return (
      <div
        className={`fullscreen-player ${queueOpen ? "fullscreen-player--with-queue-sidebar" : ""}${conflict ? " has-connect-bar" : ""}`}
        onContextMenu={onPreventMenu}
        style={{ "--fullscreen-volume": `${effectiveVolume}%` }}
      >
        {isArtworkLoaded && effectiveArtworkSrc && (
          <img
            src={effectiveArtworkSrc}
            alt=""
            aria-hidden="true"
            className="fullscreen-player-bg"
            draggable={false}
          />
        )}
        <div className="fullscreen-player-dim" aria-hidden="true" />

        <button
          type="button"
          className="fullscreen-player-close"
          aria-label="Close fullscreen player"
          title="Close"
          onClick={onCloseFull}
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>

        <main
          className={`fullscreen-player-layout ${lyricsActive ? "fullscreen-player-layout--lyrics-active" : ""}${!lyricsActive && !isSingleColumn ? " fullscreen-player-layout--desktop-no-lyrics" : ""}`}
        >
          <section className="fullscreen-player-left" aria-label="Now playing">
            <div className="fullscreen-player-stage">
              {isSingleColumn && lyricsActive ? (
                <div className="fullscreen-player-stage-lyrics">
                  <FullscreenLyrics
                    artworkUrl={thumbFailed ? null : effectiveArtworkSrc}
                    media={currentMedia}
                    mediaId={currentMedia.id}
                    onSeek={onSeek}
                    position={position}
                    lyrics={lyrics}
                    lyricsLoading={lyricsLoading}
                  />
                </div>
              ) : (
                <div className="fullscreen-player-artwork-wrap">
                  {hasArtwork ? (
                    <img
                      src={effectiveArtworkSrc}
                      alt={currentMedia.title}
                      className="fullscreen-player-artwork"
                      style={{ viewTransitionName: mediaViewTransitionName(currentMedia.id), ...(artworkShadowColor ? { "--artwork-shadow-color": artworkShadowColor } : {}) }}
                      draggable={false}
                      onContextMenu={onPreventMenu}
                      onError={onThumbError}
                      onLoad={() => {
                        setDisplayedArtworkSrc(thumbSrc);
                        setIsArtworkLoaded(true);
                      }}
                    />
                  ) : (
                    <div
                      className="fullscreen-player-artwork fullscreen-player-artwork--fallback"
                      style={{ viewTransitionName: mediaViewTransitionName(currentMedia.id) }}
                    >
                      <FontAwesomeIcon icon={meta.icon} />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="fullscreen-player-meta">
              <p>{album}</p>
              <h1 title={currentMedia.title}>{currentMedia.title}</h1>
              <span title={artist}>{artist}</span>
            </div>

            <div className="fullscreen-player-actions" aria-label="Track actions">
              {/* Unified Settings — Quality / EQ / Timer (no speed for audio) */}
              <SettingsControl
                variant="fullscreen"
                showSpeed={false}
                currentMedia={currentMedia}
                quality={quality}
                actualQuality={actualQuality}
                onChangeQuality={onChangeQuality}
                gains={eqGains}
                eqPreset={eqPreset}
                eqEnabled={eqEnabled}
                targetDb={eqTargetDb}
                onSetGain={onSetEqGain}
                onSetEqPreset={onSetEqPreset}
                onSetEqEnabled={onSetEqEnabled}
                onSetTargetDb={onSetEqTargetDb}
                onAdjustToTarget={onAdjustEqToTarget}
                sleepTimerRemaining={sleepTimerRemaining}
                sleepTimerMode={sleepTimerMode}
                hasPlaylist={hasPlaylist}
                onSetSleepTimer={onSetSleepTimer}
              />
              <button
                type="button"
                className={liked ? "fullscreen-player-icon-button fullscreen-player-icon-button--active" : "fullscreen-player-icon-button"}
                aria-label={liked ? "Remove from favorites" : "Add to favorites"}
                aria-pressed={liked}
                title={liked ? "Remove from favorites" : "Add to favorites"}
                onClick={onToggleLike}
              >
                <FontAwesomeIcon icon={faBookmark} />
              </button>
              <button
                type="button"
                className={lyricsActive ? "fullscreen-player-icon-button fullscreen-player-icon-button--active" : "fullscreen-player-icon-button"}
                aria-label={!hasLyrics ? "Lyrics unavailable" : lyricsActive ? "Hide lyrics" : "Show lyrics"}
                aria-pressed={lyricsActive}
                title={!hasLyrics ? "No lyrics available for this track" : lyricsActive ? "Hide lyrics" : "Show lyrics"}
                disabled={!hasLyrics}
                onClick={onToggleLyrics}
              >
                <FontAwesomeIcon icon={faQuoteRight} />
              </button>
              <button
                type="button"
                className={shareOpen ? "fullscreen-player-icon-button fullscreen-player-icon-button--active" : "fullscreen-player-icon-button"}
                style={{ viewTransitionName: shareOpen ? "none" : "share-media-dialog" }}
                aria-label="Share music clip"
                aria-pressed={shareOpen}
                title="Share track (lyric card & clip)"
                onClick={openShareDialog}
              >
                <FontAwesomeIcon icon={faShareNodes} />
              </button>
              <button
                type="button"
                className={queueOpen ? "fullscreen-player-icon-button fullscreen-player-icon-button--active" : "fullscreen-player-icon-button"}
                aria-label="Queue"
                aria-pressed={queueOpen}
                title="Queue"
                onClick={onOpenQueue}
              >
                <FontAwesomeIcon icon={faList} />
              </button>
            </div>

            <div className="fullscreen-player-progress">
              <input
                type="range"
                min="0"
                max={max}
                value={Math.min(position, max)}
                onChange={onSeek}
                disabled={controlsLocked}
                className="fullscreen-player-progress-range"
                aria-label="Playback position"
              />
              <div className="fullscreen-player-time">
                <span>{formatDuration(position)}</span>
                <span>-{formatDuration(remaining)}</span>
              </div>
            </div>

            <div className="fullscreen-player-controls" aria-label="Playback controls">
              <button
                type="button"
                className={shuffleEnabled ? "fullscreen-player-icon-button fullscreen-player-icon-button--active" : "fullscreen-player-icon-button"}
                aria-label="Shuffle"
                aria-pressed={shuffleEnabled}
                title="Shuffle"
                disabled={controlsLocked}
                onClick={onToggleShuffle}
              >
                <FontAwesomeIcon icon={faShuffle} />
              </button>
              <button type="button" className="fullscreen-player-transport" aria-label="Previous" disabled={controlsLocked || !hasPrev} title="Previous" onClick={() => onAdvance("prev")}>
                <FontAwesomeIcon icon={faBackwardStep} />
              </button>
              <button
                type="button"
                className="fullscreen-player-play"
                aria-label={paused ? "Play" : "Pause"}
                aria-keyshortcuts="Space"
                title={paused ? "Play (Space)" : "Pause (Space)"}
                disabled={controlsLocked}
                onClick={onToggle}
              >
                <FontAwesomeIcon icon={paused ? faPlay : faPause} />
              </button>
              <button type="button" className="fullscreen-player-transport" aria-label="Next" disabled={controlsLocked || !hasNext} title="Next" onClick={() => onAdvance("next")}>
                <FontAwesomeIcon icon={faForwardStep} />
              </button>
              <button
                type="button"
                className={loopMode !== "none" ? "fullscreen-player-icon-button fullscreen-player-icon-button--active" : "fullscreen-player-icon-button"}
                aria-label={getLoopButtonTitle(loopMode)}
                aria-pressed={loopMode !== "none"}
                title={getLoopButtonTitle(loopMode)}
                disabled={controlsLocked}
                onClick={onToggleLoop}
              >
                <RepeatIcon mode={loopMode} />
              </button>
            </div>

            <div className="fullscreen-player-volume">
              <button
                type="button"
                className="fullscreen-player-icon-button"
                aria-label={muted || volume <= 0 ? "Unmute" : "Mute"}
                aria-pressed={muted || volume <= 0}
                title={muted || volume <= 0 ? "Unmute" : "Mute"}
                onClick={onToggleMute}
              >
                <FontAwesomeIcon icon={getVolumeIcon(volume, muted)} />
              </button>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={volumePercent}
                aria-label="Volume"
                aria-valuetext={muted ? "Muted" : `${volumePercent}%`}
                title={`Volume ${effectiveVolume}%`}
                onChange={(event) => onChangeVolume(Number(event.target.value) / 100)}
                className="fullscreen-player-volume-range"
              />
            </div>
          </section>

          {!isSingleColumn && lyricsActive && (
            <div className="fullscreen-player-utilities">
              <FullscreenLyrics
                artworkUrl={thumbFailed ? null : effectiveArtworkSrc}
                media={currentMedia}
                mediaId={currentMedia.id}
                onSeek={onSeek}
                position={position}
                lyrics={lyrics}
                lyricsLoading={lyricsLoading}
              />
            </div>
          )}
        </main>

        {resumePos !== null && (
          <div style={styles.resumePrompt}>
            <button type="button" style={styles.resumeButton} onClick={onResume}>
              Resume from {formatDuration(resumePos)}
            </button>
          </div>
        )}
        {shareOpen && (
          <AudioShareDialog
            artworkUrl={effectiveArtworkSrc}
            currentMedia={currentMedia}
            duration={duration || currentMedia.duration || 0}
            initialPosition={position}
            initialTab="auto"
            lyrics={lyrics}
            lyricsLoading={lyricsLoading}
            onClose={closeShareDialog}
          />
        )}

        <SpotifyConnectBar
          className="fullscreen-player-connect-bar"
          conflict={conflict}
          canTakeOver={canTakeOver}
          onTakeOver={onTakeOver}
        />
      </div>
    );
  }

  if (isVideo) {
    return (
      <VideoPlayer
        autoPlay={autoPlay}
        currentMedia={currentMedia}
        duration={duration}
        hasNext={hasNext}
        hasPrev={hasPrev}
        liked={liked}
        loopMode={loopMode}
        mediaRef={mediaRef}
        meta={meta}
        muted={muted}
        paused={paused}
        position={position}
        queueOpen={queueOpen}
        resumePos={resumePos}
        shuffleEnabled={shuffleEnabled}
        sleepTimerRemaining={sleepTimerRemaining}
        sleepTimerMode={sleepTimerMode}
        hasPlaylist={hasPlaylist}
        streamSrc={streamSrc}
        thumbFailed={thumbFailed}
        thumbSrc={thumbSrc}
        volume={volume}
        quality={quality}
        actualQuality={actualQuality}
        onChangeQuality={onChangeQuality}
        onAdvance={onAdvance}
        onChangeVolume={onChangeVolume}
        onEnded={onEnded}
        onLoadedMetadata={onLoadedMetadata}
        onCloseFull={onCloseFull}
        onOpenQueue={onOpenQueue}
        onPause={onPause}
        onPlay={onPlay}
        onPreventMenu={onPreventMenu}
        onResume={onResume}
        onSeek={onSeek}
        onThumbError={onThumbError}
        onTimeUpdate={onTimeUpdate}
        onToggleLoop={onToggleLoop}
        onToggleMute={onToggleMute}
        onToggleShuffle={onToggleShuffle}
        onToggle={onToggle}
        onToggleLike={onToggleLike}
        onSetSleepTimer={onSetSleepTimer}
        eqGains={eqGains}
        eqPreset={eqPreset}
        eqEnabled={eqEnabled}
        eqTargetDb={eqTargetDb}
        onSetEqGain={onSetEqGain}
        onSetEqPreset={onSetEqPreset}
        onSetEqEnabled={onSetEqEnabled}
        onSetEqTargetDb={onSetEqTargetDb}
        onAdjustEqToTarget={onAdjustEqToTarget}
        conflict={conflict}
        controlsLocked={controlsLocked}
        canTakeOver={canTakeOver}
        onTakeOver={onTakeOver}
      />
    );
  }

  return (
    <div className={`premium-app-shell ${queueOpen ? "full-player--with-queue-sidebar" : ""}`} onContextMenu={onPreventMenu} style={styles.fullPage}>
      <button
        type="button"
        className="fullscreen-player-close full-player-close"
        aria-label="Close fullscreen player"
        title="Close"
        onClick={onCloseFull}
      >
        <FontAwesomeIcon icon={faXmark} />
      </button>
      <header className="app-header border-b border-card-border bg-card backdrop-blur-xl" style={styles.fullHeader}>
        <span style={{ ...styles.fullMediaBadge, marginLeft: "auto" }}>{meta.label}</span>
      </header>

      <main className="full-player-layout">
        <div className="full-player-stage">
          {isImage ? (
            <img
              src={streamSrc}
              alt={currentMedia.title}
              style={{ viewTransitionName: mediaViewTransitionName(currentMedia.id) }}
              onContextMenu={onPreventMenu}
              draggable={false}
              className="full-player-image"
            />
          ) : (
            <div className="full-player-audio-fallback">
              <FontAwesomeIcon icon={meta.icon} className="full-player-audio-fallback-icon" />
              <span className="full-player-audio-fallback-title">{currentMedia.title}</span>
            </div>
          )}
        </div>
      </main>

      {resumePos !== null && (
        <div style={styles.resumePrompt}>
          <button type="button" style={styles.resumeButton} onClick={onResume}>
            Resume from {formatDuration(resumePos)}
          </button>
        </div>
      )}

      <PlayerBar
        currentMedia={currentMedia}
        duration={duration}
        hasNext={hasNext}
        hasPrev={hasPrev}
        isImage={isImage}
        liked={liked}
        loopMode={loopMode}
        muted={muted}
        onChangeVolume={onChangeVolume}
        onAdvance={onAdvance}
        onOpenQueue={onOpenQueue}
        onSeek={onSeek}
        onToggle={onToggle}
        onToggleLike={onToggleLike}
        onToggleLoop={onToggleLoop}
        onToggleMute={onToggleMute}
        onToggleShuffle={onToggleShuffle}
        paused={paused}
        position={position}
        queueOpen={queueOpen}
        shuffleEnabled={shuffleEnabled}
        sleepTimerRemaining={sleepTimerRemaining}
        sleepTimerMode={sleepTimerMode}
        hasPlaylist={hasPlaylist}
        streamSrc={streamSrc}
        thumbSrc={thumbSrc}
        volume={volume}
        quality={quality}
        actualQuality={actualQuality}
        onChangeQuality={onChangeQuality}
        onSetSleepTimer={onSetSleepTimer}
        conflict={conflict}
        controlsLocked={controlsLocked}
        canTakeOver={canTakeOver}
        onTakeOver={onTakeOver}
      />
    </div>
  );
}
