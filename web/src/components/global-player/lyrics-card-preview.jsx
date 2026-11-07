import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faQuoteRight } from "@fortawesome/free-solid-svg-icons/faQuoteRight";
import { accessibleTextColor } from "./lyrics-share";
import { NewLogoMark } from "../new-logo-mark";

export function LyricsShareCard({
  artworkFailed,
  backgroundColor = "#202438",
  cardRef,
  metadata,
  onArtworkError,
  selected = [],
}) {
  return (
    <div ref={cardRef} className="lyrics-share-card" aria-label="Lyrics card preview" style={{ backgroundColor, color: accessibleTextColor(backgroundColor) }}>
      <div className="lyrics-share-card-brand">
        <NewLogoMark className="lyrics-share-card-logo" showName={false} decorative />
        <span className="lyrics-share-card-brand-title">Dogmedia</span>
      </div>
      <div className="lyrics-share-card-copy" data-lines={selected.length}>
        {selected.map((segment, index) => (
          <p key={`${segment.start}-${index}`}>{segment.text}</p>
        ))}
      </div>
      <footer className="lyrics-share-card-footer">
        {metadata?.artworkUrl && !artworkFailed ? (
          <img
            src={metadata.artworkUrl}
            alt=""
            crossOrigin="anonymous"
            onError={onArtworkError}
          />
        ) : (
          <span className="lyrics-share-card-art-fallback">
            <FontAwesomeIcon icon={faQuoteRight} />
          </span>
        )}
        <div>
          <strong>{metadata?.title || "Untitled track"}</strong>
          <span>{metadata?.artists || "Unknown artist"}</span>
        </div>
      </footer>
    </div>
  );
}

export default LyricsShareCard;
