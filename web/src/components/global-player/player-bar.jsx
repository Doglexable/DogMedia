import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBookmark } from "@fortawesome/free-solid-svg-icons/faBookmark";
import { AlbumArt } from "./album-art";
import { PlaybackProgress } from "./playback-progress";
import { PlayerModeControls, QualityControl, QueueButton, SleepTimerControl, TransportControls, VolumeControl } from "./player-controls";
import { TrackInfo } from "./track-info";
import { getMediaFolderName } from "./player-utils";

export function PlayerBar({
  currentMedia, duration, hasNext, hasPrev, isImage, liked, loopMode, onAdvance,
  muted, onChangeVolume, onOpenFull, onOpenQueue, onSeek, onToggle, onToggleLike,
  onToggleLoop, onToggleMute, onToggleShuffle, paused, position, queueOpen,
  shuffleEnabled, sleepTimerRemaining, streamSrc, thumbSrc, volume, onSetSleepTimer,
  quality, actualQuality, onChangeQuality,
  isMini = false,
}) {
  const isAudio = Boolean(typeof currentMedia?.mime_type === "string" && currentMedia.mime_type.startsWith("audio/"));
  const artSrc = isImage ? streamSrc : thumbSrc;
  const album = getMediaFolderName(currentMedia);
  const sectionCols = isMini
    ? "sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5 xl:grid-cols-[minmax(220px,1fr)_minmax(360px,1.5fr)_minmax(220px,1fr)] xl:gap-6"
    : "sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5 lg:grid-cols-[minmax(220px,1fr)_minmax(360px,1.5fr)_minmax(220px,1fr)] lg:gap-6";

  const middleOrder = isMini
    ? "order-2 flex flex-col items-center gap-2 sm:order-3 sm:col-span-2 xl:order-2 xl:col-span-1"
    : "order-2 flex flex-col items-center gap-2 sm:order-3 sm:col-span-2 lg:order-2 lg:col-span-1";

  const rightOrder = isMini
    ? "order-3 flex items-center justify-center gap-1 sm:order-2 sm:justify-end xl:order-3"
    : "order-3 flex items-center justify-center gap-1 sm:order-2 sm:justify-end lg:order-3";

  return (
    <section
      aria-label="Media player"
      onContextMenu={(event) => event.preventDefault()}
      className={`themed-player-bar fixed inset-x-0 bottom-0 z-[180] grid min-h-[var(--player-height)] grid-cols-1 items-center gap-3 border-t border-card-border bg-card px-4 py-3 text-content shadow-[0_-18px_60px_rgba(0,0,0,0.22)] backdrop-blur-2xl ${sectionCols}`}
    >
      <div className="order-1 flex min-w-0 items-center gap-3">
        <AlbumArt
          src={artSrc}
          alt={currentMedia?.title}
          onClick={onOpenFull}
          priority
        />
        <TrackInfo
          album={album}
          artists={currentMedia?.artists || currentMedia?.artist}
          currentMedia={currentMedia}
          media={currentMedia}
          onOpenFull={onOpenFull}
          title={currentMedia?.title}
        />
      </div>

      <div className={middleOrder}>
        <div className="flex items-center gap-3">
          <TransportControls
            hasNext={hasNext}
            hasPrev={hasPrev}
            isImage={isImage}
            onAdvance={onAdvance}
            onToggle={onToggle}
            paused={paused}
          />
        </div>
        <PlaybackProgress
          currentMedia={currentMedia}
          duration={duration}
          isImage={isImage}
          position={position}
          onSeek={onSeek}
        />
      </div>

      <div className={rightOrder}>
        <QualityControl
          currentMedia={currentMedia}
          quality={quality}
          actualQuality={actualQuality}
          onChangeQuality={onChangeQuality}
          variant="ghost"
        />
        {isAudio && (
          <button
            type="button"
            aria-label={liked ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={liked}
            onClick={onToggleLike}
            className={`player-ghost-button ${liked ? "text-[var(--primary)]" : "text-muted"}`}
            title={liked ? "Remove from favorites" : "Add to favorites"}
          >
            <FontAwesomeIcon icon={faBookmark} className={`transition-transform duration-200 ${liked ? "scale-110" : "scale-100"}`} />
          </button>
        )}
        <VolumeControl
          isImage={isImage}
          muted={muted}
          volume={volume}
          onChangeVolume={onChangeVolume}
          onToggleMute={onToggleMute}
        />
        <PlayerModeControls
          loopMode={loopMode}
          shuffleEnabled={shuffleEnabled}
          onToggleLoop={onToggleLoop}
          onToggleShuffle={onToggleShuffle}
        />
        <SleepTimerControl remainingSeconds={sleepTimerRemaining} onSetSleepTimer={onSetSleepTimer} />
        <QueueButton active={queueOpen} onClick={onOpenQueue} />
      </div>
    </section>
  );
}
