import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { AmbientArtwork } from "./ambient-artwork";
import { PlayerBar } from "./player-bar";
import { NowPlayingSidebar } from "./now-playing-sidebar";
import { playerStyles as styles } from "./player-styles";
import { formatDuration } from "./player-utils";

export function FullPlayer({
  autoPlay, currentMedia, duration, hasNext, hasPrev, isAudio, isImage, isVideo,
  loopMode, mediaRef, meta, muted, paused, position, queueOpen, resumePos,
  shuffleEnabled, streamSrc, thumbFailed, thumbSrc, volume, onAdvance,
  onChangeVolume, onEnded, onLoadedMetadata, onOpenQueue, onPause, onPlay,
  onPreventMenu, onResume, onSeek, onThumbError, onTimeUpdate, onToggleLoop,
  onToggleMute, onToggleShuffle, onToggle, liked, onToggleLike,
}) {
  return (
    <div className="premium-app-shell" style={styles.fullPage}>
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
