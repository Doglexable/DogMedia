import { MediaArtists } from "./media-artists";

export function TrackInfo({ album, artists, title }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-sm font-bold tracking-tight text-content" title={title}>{title}</div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted">
        <MediaArtists artists={artists} />
        <span aria-hidden="true" className="opacity-50">•</span>
        <span className="truncate" title={album}>{album}</span>
      </div>
    </div>
  );
}
