import { getArtistLabel, resolveMediaArtist } from "./player-utils";

export { getArtistLabel, resolveMediaArtist };

export function MediaArtists({ artists, media, fallback = "Unknown artist" }) {
  const label = media ? resolveMediaArtist(media, fallback) : getArtistLabel(artists, fallback);

  return <span className="shrink-0 truncate" title={label}>{label}</span>;
}

