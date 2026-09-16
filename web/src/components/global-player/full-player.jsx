import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBackwardStep,
  faBookmark,
  faForwardStep,
  faInfinity,
  faList,
  faPause,
  faPlay,
  faRepeat,
  faShuffle,
  faVolumeHigh,
  faVolumeLow,
  faVolumeXmark,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { AmbientArtwork } from "./ambient-artwork";
import { PlayerBar } from "./player-bar";
import { QualityControl, SleepTimerControl } from "./player-controls";
import { FullscreenLyrics } from "./lyrics-panel";
import { getArtistLabel, resolveMediaArtist } from "./media-artists";
import { VideoPlayer } from "./video-player";
import { playerStyles as styles } from "./player-styles";
import { formatDuration, getLoopButtonTitle, getMediaFolderName } from "./player-utils";

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
  shuffleEnabled, sleepTimerRemaining, streamSrc, thumbFailed, thumbSrc, volume, onAdvance,
  onChangeVolume, onEnded, onLoadedMetadata, onOpenQueue, onPause, onPlay,
  onPreventMenu, onResume, onSeek, onThumbError, onTimeUpdate, onToggleLoop,
  onToggleMute, onToggleShuffle, onToggle, liked, onToggleLike, onCloseFull,
  onSetSleepTimer,
  quality, actualQuality, onChangeQuality,
}) {
  if (isAudio) {
    const album = getMediaFolderName(currentMedia) || "Library";
    const artist = resolveMediaArtist(currentMedia, album);
    const [loadedArtworkSrc, setLoadedArtworkSrc] = useState("");
    const max = Math.max(duration || currentMedia.duration || 0, position, 1);
    const remaining = Math.max((duration || currentMedia.duration || 0) - position, 0);
    const hasArtwork = Boolean(thumbSrc) && !thumbFailed;
    const isArtworkLoaded = hasArtwork && loadedArtworkSrc === thumbSrc;
    const volumePercent = Math.round(volume * 100);
    const effectiveVolume = muted ? 0 : volumePercent;

    return (
      <div
        className="premium-app-shell fullscreen-player"
        onContextMenu={onPreventMenu}
        style={{ "--fullscreen-volume": `${effectiveVolume}%` }}
      >
        {isArtworkLoaded && (
          <img
            src={thumbSrc}
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

        <main className="fullscreen-player-layout">
          <section className="fullscreen-player-left" aria-label="Now playing">
            <div className="fullscreen-player-artwork-wrap">
              {hasArtwork ? (
                <img
                  src={thumbSrc}
                  alt={currentMedia.title}
                  className="fullscreen-player-artwork"
                  draggable={false}
                  onContextMenu={onPreventMenu}
                  onError={onThumbError}
                  onLoad={() => setLoadedArtworkSrc(thumbSrc)}
                />
              ) : (
                <div className="fullscreen-player-artwork fullscreen-player-artwork--fallback">
                  <FontAwesomeIcon icon={meta.icon} />
                </div>
              )}
            </div>

            <div className="fullscreen-player-meta">
              <p>{album}</p>
              <h1 title={currentMedia.title}>{currentMedia.title}</h1>
              <span title={artist}>{artist}</span>
            </div>

            <div className="fullscreen-player-actions" aria-label="Track actions">
              <QualityControl
                currentMedia={currentMedia}
                quality={quality}
                actualQuality={actualQuality}
                onChangeQuality={onChangeQuality}
                variant="fullscreen"
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
              <SleepTimerControl
                remainingSeconds={sleepTimerRemaining}
                onSetSleepTimer={onSetSleepTimer}
                variant="fullscreen"
              />
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
                onClick={onToggleShuffle}
              >
                <FontAwesomeIcon icon={faShuffle} />
              </button>
              <button type="button" className="fullscreen-player-transport" aria-label="Previous" disabled={!hasPrev} title="Previous" onClick={() => onAdvance("prev")}>
                <FontAwesomeIcon icon={faBackwardStep} />
              </button>
              <button type="button" className="fullscreen-player-play" aria-label={paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause"} onClick={onToggle}>
                <FontAwesomeIcon icon={paused ? faPlay : faPause} />
              </button>
              <button type="button" className="fullscreen-player-transport" aria-label="Next" disabled={!hasNext} title="Next" onClick={() => onAdvance("next")}>
                <FontAwesomeIcon icon={faForwardStep} />
              </button>
              <button
                type="button"
                className={loopMode !== "none" ? "fullscreen-player-icon-button fullscreen-player-icon-button--active" : "fullscreen-player-icon-button"}
                aria-label={getLoopButtonTitle(loopMode)}
                aria-pressed={loopMode !== "none"}
                title={getLoopButtonTitle(loopMode)}
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

          <div className="fullscreen-player-utilities">
            <FullscreenLyrics artworkUrl={thumbFailed ? null : thumbSrc} media={currentMedia} mediaId={currentMedia.id} onSeek={onSeek} position={position} />
          </div>
        </main>

        {resumePos !== null && (
          <div style={styles.resumePrompt}>
            <button type="button" style={styles.resumeButton} onClick={onResume}>
              Resume from {formatDuration(resumePos)}
            </button>
          </div>
        )}
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
      />
    );
  }

  return (
    <div className="premium-app-shell" onContextMenu={onPreventMenu} style={styles.fullPage}>
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

      <main className="full-player-layout full-player-layout--no-sidebar">
        <div className="full-player-stage">
          {isImage ? (
            <img
              src={streamSrc}
              alt={currentMedia.title}
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
        streamSrc={streamSrc}
        thumbSrc={thumbSrc}
        volume={volume}
        quality={quality}
        actualQuality={actualQuality}
        onChangeQuality={onChangeQuality}
        onSetSleepTimer={onSetSleepTimer}
      />
    </div>
  );
}
