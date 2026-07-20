export function getArtistLabel(artists) {
  if (typeof artists !== "string") return "Unknown artist";
  return artists.trim() || "Unknown artist";
}

export function MediaArtists({ artists }) {
  const label = getArtistLabel(artists);

  return <span className="shrink-0 truncate" title={label}>{label}</span>;
}
