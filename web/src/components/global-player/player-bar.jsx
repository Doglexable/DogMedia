import { useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBookmark } from "@fortawesome/free-solid-svg-icons/faBookmark";
import { AlbumArt } from "./album-art";
import SpotifyConnectBar from "./spotify-connect-bar";
import { PlaybackProgress } from "./playback-progress";
import { LoopButton, QualityControl, QueueButton, ShuffleButton, SleepTimerControl, TransportControls, VolumeControl } from "./player-controls";
import { TrackInfo } from "./track-info";
import { getMediaFolderName } from "./player-utils";
import { mediaViewTransitionName } from "../../utils/view-transitions";

export function PlayerBar({
  currentMedia, duration, hasNext, hasPrev, isImage, liked, loopMode, onAdvance,
  muted, onChangeVolume, onOpenFull, onOpenQueue, onSeek, onToggle, onToggleLike,
  onToggleLoop, onToggleMute, onToggleShuffle, paused, position, queueOpen,
  shuffleEnabled, sleepTimerRemaining, sleepTimerMode, hasPlaylist, streamSrc, thumbSrc, volume, onSetSleepTimer,
  quality, actualQuality, onChangeQuality,
  conflict, controlsLocked = false,
  canTakeOver = false, onTakeOver,
  isMini = false,
}) {
  const hasConflict = Boolean(conflict);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    // Connect bar adds a 24px strip below the player, so floating UI stacked
    // above the player must account for it while a conflict is active.
    document.documentElement.style.setProperty(
      "--active-player-height",
      hasConflict ? "calc(var(--player-height) + 24px)" : "var(--player-height)",
    );
    return () => {
      document.documentElement.style.removeProperty("--active-player-height");
    };
  }, [hasConflict]);

  const isAudio = Boolean(typeof currentMedia?.mime_type === "string" && currentMedia.mime_type.startsWith("audio/"));
  const artSrc = isImage ? streamSrc : thumbSrc;
  const album = getMediaFolderName(currentMedia);
  return (
    <section
      aria-label="Media player"
      onContextMenu={(event) => event.preventDefault()}
      className={`themed-player-bar web-mini-player${isMini ? " web-mini-player--compact" : ""}${conflict ? " has-connect-bar" : ""}`}
    >
      <div className="web-mini-identity-wrap">
        <AlbumArt
          src={artSrc}
          alt={currentMedia?.title}
          onClick={onOpenFull}
          priority
          transitionName={mediaViewTransitionName(currentMedia?.id)}
        />
        <button type="button" className="web-mini-copy-button" onClick={onOpenFull} title="Open full player">
          <TrackInfo
            album={album}
            artists={currentMedia?.artists || currentMedia?.artist}
            currentMedia={currentMedia}
            media={currentMedia}
            title={currentMedia?.title}
          />
        </button>
        {isAudio && (
          <button
            type="button"
            aria-label={liked ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={liked}
            onClick={onToggleLike}
            className={`player-ghost-button web-mini-favorite ${liked ? "text-[var(--primary)]" : "text-muted"}`}
            title={liked ? "Remove from favorites" : "Add to favorites"}
          >
            <FontAwesomeIcon icon={faBookmark} className={`transition-transform duration-200 ${liked ? "scale-110" : "scale-100"}`} />
          </button>
        )}
      </div>

      <div className="web-mini-transport">
        <div className="web-mini-transport-buttons">
          {!isImage && <ShuffleButton active={shuffleEnabled} onClick={onToggleShuffle} />}
          <TransportControls
            disabled={controlsLocked}
            hasNext={hasNext}
            hasPrev={hasPrev}
            isImage={isImage}
            onAdvance={onAdvance}
            onToggle={onToggle}
            paused={paused}
          />
          {!isImage && <LoopButton mode={loopMode} onClick={onToggleLoop} />}
        </div>
        <PlaybackProgress
          currentMedia={currentMedia}
          duration={duration}
          isImage={isImage}
          position={position}
          onSeek={controlsLocked ? undefined : onSeek}
        />
      </div>

      <div className="web-mini-tools">
        <QualityControl
          currentMedia={currentMedia}
          quality={quality}
          actualQuality={actualQuality}
          onChangeQuality={onChangeQuality}
          variant="ghost"
        />
        <VolumeControl
          isImage={isImage}
          muted={muted}
          volume={volume}
          onChangeVolume={onChangeVolume}
          onToggleMute={onToggleMute}
        />
        <SleepTimerControl
          remainingSeconds={sleepTimerRemaining}
          sleepTimerMode={sleepTimerMode}
          hasPlaylist={hasPlaylist}
          onSetSleepTimer={onSetSleepTimer}
        />
        <QueueButton active={queueOpen} onClick={onOpenQueue} />
      </div>

      <SpotifyConnectBar
        conflict={conflict}
        canTakeOver={canTakeOver}
        onTakeOver={onTakeOver}
      />
    </section>
  );
}
