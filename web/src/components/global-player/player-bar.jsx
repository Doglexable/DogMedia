import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHeart } from "@fortawesome/free-solid-svg-icons";
import { AlbumArt } from "./album-art";
import { PlaybackProgress } from "./playback-progress";
import { PlayerModeControls, QueueButton, TransportControls, VolumeControl } from "./player-controls";
import { TrackInfo } from "./track-info";
import { getMediaFolderName, getMediaMeta } from "./player-utils";

export function PlayerBar({
  currentMedia, duration, hasNext, hasPrev, isImage, liked, loopMode, onAdvance,
  muted, onChangeVolume, onOpenFull, onOpenQueue, onSeek, onToggle, onToggleLike,
  onToggleLoop, onToggleMute, onToggleShuffle, paused, position, queueOpen,
  shuffleEnabled, streamSrc, thumbSrc, volume,
}) {
  const isAudio = currentMedia.mime_type?.startsWith("audio/");
  const artSrc = isImage ? streamSrc : thumbSrc;
  const folder = getMediaFolderName(currentMedia) || "Library";
  const artists = isAudio ? currentMedia.artists : getMediaMeta(currentMedia.mime_type).label;

  return (
    <section aria-label="Media player" className="themed-player-bar fixed inset-x-0 bottom-0 z-[180] grid min-h-[var(--player-height)] grid-cols-1 items-center gap-3 border-t border-card-border bg-card px-4 py-3 text-content shadow-[0_-18px_60px_rgba(0,0,0,0.22)] backdrop-blur-2xl sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5 lg:grid-cols-[minmax(220px,1fr)_minmax(360px,1.5fr)_minmax(220px,1fr)] lg:gap-6">
      <div className="order-1 flex min-w-0 items-center gap-3">
        <AlbumArt src={artSrc} alt={currentMedia.title} onClick={onOpenFull} />
        <TrackInfo title={currentMedia.title} artists={artists} album={folder} />
      </div>

      <div className="order-2 grid min-w-0 gap-2 sm:order-3 sm:col-span-2 lg:order-2 lg:col-span-1">
        <div className="flex items-center justify-center gap-2">
          <TransportControls
            hasNext={hasNext}
            hasPrev={hasPrev}
            isImage={isImage}
            paused={paused}
            onAdvance={onAdvance}
            onToggle={onToggle}
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

      <div className="order-3 flex items-center justify-center gap-1 sm:order-2 sm:justify-end lg:order-3">
        {isAudio && (
          <button
            type="button"
            aria-label={liked ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={liked}
            onClick={onToggleLike}
            className={`player-ghost-button ${liked ? "text-[var(--primary)]" : "text-muted"}`}
            title={liked ? "Remove from Liked Music" : "Add to Liked Music"}
          >
            <FontAwesomeIcon icon={faHeart} className={`transition-transform duration-200 ${liked ? "scale-110" : "scale-100"}`} />
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
        <QueueButton active={queueOpen} onClick={onOpenQueue} />
      </div>
    </section>
  );
}
