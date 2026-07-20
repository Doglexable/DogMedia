import { formatDuration } from "./player-utils";

export function PlaybackProgress({ currentMedia, duration, isImage, position, onSeek }) {
  const max = Math.max(duration || currentMedia.duration || 0, position, 1);

  return (
    <div className="grid w-full grid-cols-[38px_minmax(80px,1fr)_38px] items-center gap-2 text-[11px] font-medium tabular-nums text-muted">
      <span className="text-right">{formatDuration(position)}</span>
      <input
        type="range"
        min="0"
        max={max}
        value={Math.min(position, max)}
        onChange={onSeek}
        disabled={isImage}
        className="player-progress-range h-1 w-full cursor-pointer appearance-none rounded-full accent-[var(--primary)] transition-all duration-200 hover:h-1.5 disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--primary)]"
        aria-label="Playback position"
      />
      <span>{formatDuration(duration || currentMedia.duration)}</span>
    </div>
  );
}
