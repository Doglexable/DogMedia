import { memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHeart } from "@fortawesome/free-solid-svg-icons";

function getMimeMeta(mime) {
  if (!mime) return { icon: "📁", label: "File", color: "#888" };
  if (mime.startsWith("video/")) return { icon: "▶️", label: "Video", color: "#4a90d9" };
  if (mime.startsWith("audio/")) return { icon: "🎵", label: "Audio", color: "#9b59b6" };
  if (mime.startsWith("image/")) return { icon: "🖼️", label: "Photo", color: "#27ae60" };
  return { icon: "📁", label: "File", color: "#888" };
}

function formatCardDuration(seconds) {
  if (!seconds) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function MediaCard({ item, isActive, isLiked, onAddQueue, onError, onPlay, onPlayNext, onToggleLike }) {
  const [hovered, setHovered] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [menu, setMenu] = useState(null);
  const meta = getMimeMeta(item.mime_type);
  const category = item.category_path || item.category_name || "Uncategorized";

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

  const addToQueue = () => {
    setMenu(null);
    onAddQueue(item)
      .then(() => onError(`“${item.title}” is in the queue.`))
      .catch((error) => onError(error.message));
  };

  const playNext = () => {
    setMenu(null);
    onPlayNext(item)
      .then(() => onError(`“${item.title}” will play next.`))
      .catch((error) => onError(error.message));
  };

  return (
    <article
      className={`media-card${isActive ? " media-card--active" : ""}`}
      style={{
        transform: hovered ? "translateY(-3px)" : "none",
        boxShadow: isActive ? "0 0 0 1px var(--primary)" : hovered ? "0 8px 24px rgba(0,0,0,0.12)" : "none",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 105) });
      }}
    >
      {!imgFailed && (
        <img
          src={`/api/media/${item.id}/thumbnail`}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="media-card-ambient-image"
        />
      )}
      <button type="button" className="media-card-main" onClick={() => onPlay(item)}>
        <div className="media-card-cover" style={{ background: `${meta.color}18` }}>
          {!imgFailed ? (
            <img
              src={`/api/media/${item.id}/thumbnail`}
              alt={item.title}
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              onError={() => setImgFailed(true)}
              className="media-card-cover-image"
            />
          ) : (
            <div className="media-card-cover-fallback">
              <span className="media-card-cover-icon">{meta.icon}</span>
              <span className="media-card-fallback-badge" style={{ color: meta.color, background: `${meta.color}22` }}>{meta.label}</span>
            </div>
          )}
        </div>
        <div className="media-card-body">
          <div className="media-card-title" title={item.title}>{item.title}</div>
          <div className="media-card-category" title={category}>{category}</div>
          <div className="media-card-footer">
            <span className="media-card-type" style={{ color: meta.color, background: `${meta.color}18` }}>{meta.label}</span>
            <span className="media-card-duration">{formatCardDuration(item.duration)}</span>
          </div>
        </div>
      </button>

      {item.mime_type?.startsWith("audio/") && (
        <button type="button" className={`media-card-like${isLiked ? " media-card-like--active" : ""}`} aria-label={isLiked ? `Unlike ${item.title}` : `Like ${item.title}`} title={isLiked ? "Remove from Liked Music" : "Add to Liked Music"} onClick={() => onToggleLike(item)}>
          <FontAwesomeIcon icon={faHeart} className={`transition-transform duration-200 ${isLiked ? "scale-110" : "scale-100"}`} />
        </button>
      )}

      {menu && createPortal(
        <div role="menu" onClick={(event) => event.stopPropagation()} style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 500, minWidth: 170, padding: 6, border: "1px solid var(--card-border)", borderRadius: 8, background: "var(--card-bg)", boxShadow: "0 12px 32px rgba(0,0,0,.25)" }}>
          <button type="button" role="menuitem" onClick={playNext} style={{ width: "100%", padding: "9px 11px", border: "none", borderRadius: 6, background: "transparent", color: "var(--text)", textAlign: "left", cursor: "pointer", fontWeight: 700 }}>Play next</button>
          <button type="button" role="menuitem" onClick={addToQueue} style={{ width: "100%", padding: "9px 11px", border: "none", borderRadius: 6, background: "transparent", color: "var(--text)", textAlign: "left", cursor: "pointer", fontWeight: 700 }}>Add to queue</button>
        </div>,
        document.body
      )}
    </article>
  );
}

export default memo(MediaCard);
