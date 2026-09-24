import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBookmark } from "@fortawesome/free-solid-svg-icons/faBookmark";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons/faEllipsis";
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
import { formatDuration } from "../global-player/player-utils";

function getMediaLabel(mime) {
  if (typeof mime !== "string") return "File";
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Audio";
  if (mime.startsWith("image/")) return "Photo";
  return "File";
}

function formatArtists(item, fallback) {
  if (Array.isArray(item?.artists)) {
    const artists = item.artists.map((artist) => String(artist).trim()).filter(Boolean);
    if (artists.length) return artists.join(", ");
  }
  if (typeof item?.artists === "string" && item.artists.trim()) return item.artists.trim();
  if (typeof item?.artist === "string" && item.artist.trim()) return item.artist.trim();
  return fallback;
}

function formatAddedDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function MediaCard({ index, item, isActive, isLiked, onAddQueue, onError, onPlay, onPlayNext, onToggleLike }) {
  const [menu, setMenu] = useState(null);
  const category = item.category_path || item.category_name || "Uncategorized";
  const isAudio = item.mime_type?.startsWith("audio/");

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const closeOnEscape = (event) => { if (event.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  const notifyAction = (action, successMessage) => {
    setMenu(null);
    Promise.resolve(action?.(item))
      .then(() => onError?.(successMessage))
      .catch((error) => onError?.(error.message));
  };

  const addToQueue = () => notifyAction(onAddQueue, `“${item.title}” is in the queue.`);
  const playNext = () => notifyAction(onPlayNext, `“${item.title}” will play next.`);
  const toggleFavorite = () => {
    setMenu(null);
    Promise.resolve(onToggleLike?.(item))
      .then((liked) => onError?.(`“${item.title}” ${liked ? "was added to" : "was removed from"} favorites.`))
      .catch((error) => onError?.(error.message));
  };

  const openMenuAt = (x, y) => {
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 188)),
      y: Math.max(8, Math.min(y, window.innerHeight - 150)),
    });
  };

  return (
    <article
      className={`media-track${isActive ? " media-track--active" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenuAt(event.clientX, event.clientY);
      }}
    >
      <button type="button" className="media-track-main" onClick={() => onPlay(item)} aria-label={`Play ${item.title}`}>
        <span className="media-track-leading" aria-hidden="true">
          <span className="media-track-index">{index}</span>
          <FontAwesomeIcon className="media-track-play" icon={faPlay} />
        </span>

        <span className="media-track-title-cell">
          <span className="media-track-copy">
            <strong title={item.title}>{item.title}</strong>
            <small title={formatArtists(item, getMediaLabel(item.mime_type))}>{formatArtists(item, getMediaLabel(item.mime_type))}</small>
          </span>
        </span>

        <span className="media-track-folder" title={category}>{category}</span>
        <span className="media-track-added">{formatAddedDate(item.created_at)}</span>
        <span className="media-track-duration">{item.duration ? formatDuration(item.duration) : "-"}</span>
      </button>

      <span className="media-track-actions">
        {isAudio && (
          <button
            type="button"
            className={`media-track-favorite${isLiked ? " media-track-favorite--active" : ""}`}
            aria-label={isLiked ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`}
            aria-pressed={isLiked}
            title={isLiked ? "Remove from favorites" : "Add to favorites"}
            onClick={toggleFavorite}
          >
            <FontAwesomeIcon icon={faBookmark} />
          </button>
        )}
        <button
          type="button"
          className="media-track-more"
          aria-label={`More options for ${item.title}`}
          aria-haspopup="menu"
          aria-expanded={Boolean(menu)}
          title="More options"
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            openMenuAt(rect.right - 180, rect.bottom + 6);
          }}
        >
          <FontAwesomeIcon icon={faEllipsis} />
        </button>
      </span>

      {menu && createPortal(
        <div
          className="media-track-menu"
          role="menu"
          onContextMenu={(event) => event.preventDefault()}
          onClick={(event) => event.stopPropagation()}
          style={{ left: menu.x, top: menu.y }}
        >
          <button type="button" role="menuitem" onClick={playNext}>Play next</button>
          <button type="button" role="menuitem" onClick={addToQueue}>Add to queue</button>
          {isAudio && (
            <button type="button" role="menuitem" onClick={toggleFavorite}>
              {isLiked ? "Remove from favorites" : "Add to favorites"}
            </button>
          )}
        </div>,
        document.body,
      )}
    </article>
  );
}

export default memo(MediaCard);
