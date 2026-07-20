import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMusic } from "@fortawesome/free-solid-svg-icons";
import { AmbientArtwork } from "./ambient-artwork";

export function AlbumArt({ alt, onClick, src }) {
  const content = (
    <AmbientArtwork
      src={src}
      alt={alt}
      className="ambient-artwork--player-bar h-16 w-16 shrink-0"
      fallback={<FontAwesomeIcon icon={faMusic} className="ambient-artwork__fallback text-xl text-muted" />}
    />
  );

  if (!onClick) return content;
  return (
    <button type="button" onClick={onClick} aria-label={`Open ${alt}`} className="ambient-artwork-button rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">
      {content}
    </button>
  );
}
