import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBackwardStep,
  faBookmark,
  faEllipsis,
  faForwardStep,
  faInfinity,
  faMessage,
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
import { NowPlayingSidebar } from "./now-playing-sidebar";
import { getArtistLabel } from "./media-artists";
import { FullscreenLyrics } from "./lyrics-panel";
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
  shuffleEnabled, streamSrc, thumbFailed, thumbSrc, volume, onAdvance,
  onChangeVolume, onEnded, onLoadedMetadata, onOpenQueue, onPause, onPlay,
  onPreventMenu, onResume, onSeek, onThumbError, onTimeUpdate, onToggleLoop,
  onToggleMute, onToggleShuffle, onToggle, liked, onToggleLike, onCloseFull,
}) {
  if (isAudio) {
    const album = getMediaFolderName(currentMedia) || "Library";
    const artist = getArtistLabel(currentMedia.artists);
    const max = Math.max(duration || currentMedia.duration || 0, position, 1);
    const remaining = Math.max((duration || currentMedia.duration || 0) - position, 0);
    const hasArtwork = Boolean(thumbSrc) && !thumbFailed;
    const volumePercent = Math.round(volume * 100);
    const effectiveVolume = muted ? 0 : volumePercent;

    return (
      <div className="premium-app-shell fullscreen-player" style={{ "--fullscreen-volume": `${effectiveVolume}%` }}>
        {hasArtwork && (
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
                className={queueOpen ? "fullscreen-player-icon-button fullscreen-player-icon-button--active" : "fullscreen-player-icon-button"}
                aria-label="Queue"
                aria-pressed={queueOpen}
                title="Queue"
                onClick={onOpenQueue}
              >
                <FontAwesomeIcon icon={faEllipsis} />
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

          <FullscreenLyrics mediaId={currentMedia.id} onSeek={onSeek} position={position} />
        </main>

        <button
          type="button"
          className={queueOpen ? "fullscreen-player-message fullscreen-player-message--active" : "fullscreen-player-message"}
          aria-label="Queue"
          aria-pressed={queueOpen}
          title="Queue"
          onClick={onOpenQueue}
        >
          <FontAwesomeIcon icon={faMessage} />
        </button>

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

  return (
    <div className="premium-app-shell" style={styles.fullPage}>
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
          {isAudio && (
            <div className="full-player-audio-shell">
              <AmbientArtwork
                src={thumbSrc}
                alt={currentMedia.title}
                className="full-player-audio-artwork"
                onError={onThumbError}
                onContextMenu={onPreventMenu}
                fallback={
                  <span className="full-player-audio-fallback">
                    <FontAwesomeIcon icon={meta.icon} className="full-player-audio-fallback-icon" />
                    <span className="full-player-audio-fallback-title">{currentMedia.title}</span>
                  </span>
                }
              />
            </div>
          )}

          {isVideo && (
            <video
              ref={mediaRef}
              src={streamSrc}
              controls={false}
              controlsList="nodownload noplaybackrate"
              disablePictureInPicture
              disableRemotePlayback
              autoPlay={autoPlay}
              muted={muted || volume <= 0}
              className="full-player-video"
              onContextMenu={onPreventMenu}
              onPlay={onPlay}
              onPause={onPause}
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoadedMetadata}
              onEnded={onEnded}
            />
          )}

          {isImage && (
            <img
              src={streamSrc}
              alt={currentMedia.title}
              onContextMenu={onPreventMenu}
              draggable={false}
              className="full-player-image"
            />
          )}
        </div>

        <NowPlayingSidebar
          currentMedia={currentMedia}
          duration={duration}
          isAudio={isAudio}
          isImage={isImage}
          meta={meta}
          onPreventMenu={onPreventMenu}
          onSeek={onSeek}
          onThumbError={onThumbError}
          position={position}
          streamSrc={streamSrc}
          thumbFailed={thumbFailed}
          thumbSrc={thumbSrc}
        />
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
        streamSrc={streamSrc}
        thumbSrc={thumbSrc}
        volume={volume}
      />
    </div>
  );
}
