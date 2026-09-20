import { useEffect, useRef, useState } from "react";
import { mediaThumbnailUrl } from "../../api";

export function PlaylistCompleteDialog({ suggestion, onDismiss, onPlay }) {
  const dismissRef = useRef(null);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const media = suggestion?.media;
  const category = suggestion?.category;
  const artworkSrc = mediaThumbnailUrl(media);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    dismissRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onDismiss]);

  if (!media || !category) return null;

  return (
    <div
      className="sleep-timer-complete-overlay"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onDismiss(); }}
    >
      <div
        className="sleep-timer-complete-dialog playlist-complete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="playlist-complete-title"
        aria-describedby="playlist-complete-description"
      >
        <span className="sleep-timer-complete-kicker">Playlist complete</span>
        <h2 id="playlist-complete-title">Keep it going?</h2>
        <p id="playlist-complete-description">
          Here is another folder alongside the one you just finished. Nothing has been added to your queue.
        </p>

        <div className="playlist-complete-handoff">
          <div className="playlist-complete-artwork" aria-hidden="true">
            {artworkSrc && !artworkFailed ? (
              <img src={artworkSrc} alt="" onError={() => setArtworkFailed(true)} />
            ) : (
              <span>▶</span>
            )}
          </div>
          <div className="playlist-complete-copy">
            <span className="playlist-complete-folder">Next folder · {category.name}</span>
            <strong>{media.title}</strong>
            {media.artists && <small>{media.artists}</small>}
          </div>
          <span className="playlist-complete-arrow" aria-hidden="true">→</span>
        </div>

        <div className="sleep-timer-complete-actions">
          <button ref={dismissRef} type="button" className="sleep-timer-complete-button" onClick={onDismiss}>
            Not now
          </button>
          <button type="button" className="sleep-timer-complete-button sleep-timer-complete-button--primary" onClick={onPlay}>
            Play suggestion
          </button>
        </div>
      </div>
    </div>
  );
}
