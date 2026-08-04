import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBookmark, faChevronRight, faList, faPlay, faPlus } from "@fortawesome/free-solid-svg-icons";
import { useAccess } from "../App";
import { api } from "../api";
import { useGlobalPlayer } from "../components/GlobalPlayer";
import { useLibrary } from "../components/library-shell";
import { MediaSearch } from "../components/dashboard/media-search";
import { formatDuration } from "../components/global-player/player-utils";

const NOW_PLAYING_POLL_MS = 10000;
const NOW_PLAYING_TICK_MS = 1000;

function MediaGridSkeleton({ count = 8 }) {
  return (
    <div className="media-card-grid" role="status" aria-label="Loading media" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="media-card-skeleton" aria-hidden="true">
          <div className="media-card-skeleton-cover skeleton-shimmer" />
          <div className="media-card-skeleton-body">
            <span className="skeleton-shimmer h-4 w-4/5 rounded" />
            <span className="skeleton-shimmer h-3 w-3/5 rounded" />
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="skeleton-shimmer h-5 w-14 rounded-full" />
              <span className="skeleton-shimmer h-3 w-8 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function playbackStateLabels(session) {
  const labels = [];
  if (session.loopMode === "queue") labels.push("loop queue");
  if (session.loopMode === "media") labels.push("loop media");
  if (session.shuffleEnabled) labels.push("shuffle");
  return labels;
}

function getMimeMeta(mime) {
  if (!mime) return { icon: "□", label: "File" };
  if (mime.startsWith("video/")) return { icon: "▶", label: "Video" };
  if (mime.startsWith("audio/")) return { icon: "♪", label: "Audio" };
  if (mime.startsWith("image/")) return { icon: "◧", label: "Photo" };
  return { icon: "□", label: "File" };
}

function mediaCategory(item) {
  return item?.category_path || item?.category_name || "Library";
}

function EmptyLibraryMark() {
  return (
    <svg className="dashboard-empty-illustration" viewBox="0 0 160 120" role="img" aria-label="Empty folder">
      <path className="dashboard-empty-illustration-shadow" d="M35 103h90c11 0 20-9 20-20V52c0-11-9-20-20-20H84l-9-12H36c-11 0-20 9-20 20v43c0 11 8 20 19 20Z" />
      <path className="dashboard-empty-illustration-folder" d="M23 42c0-8 6-14 14-14h34l10 12h42c8 0 14 6 14 14v32c0 8-6 14-14 14H37c-8 0-14-6-14-14V42Z" />
      <path className="dashboard-empty-illustration-lid" d="M23 46h114v12H23z" />
      <path className="dashboard-empty-illustration-line" d="M54 73h52M66 84h28" />
    </svg>
  );
}

function EmptySearchMark() {
  return (
    <svg className="dashboard-empty-illustration" viewBox="0 0 160 120" role="img" aria-label="No matching media">
      <circle className="dashboard-empty-illustration-folder" cx="70" cy="58" r="32" />
      <path className="dashboard-empty-illustration-line" d="M93 82l25 25M58 54h24M70 42v24" />
      <circle className="dashboard-empty-illustration-dot" cx="116" cy="30" r="8" />
    </svg>
  );
}

function MediaCover({ circular = false, item, size = "regular" }) {
  const [failed, setFailed] = useState(false);
  const meta = getMimeMeta(item?.mime_type);

  return (
    <span className={`library-cover library-cover--${size}${circular ? " library-cover--circle" : ""}`}>
      {!failed && item?.id ? (
        <img
          src={`/api/media/${item.id}/thumbnail`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="library-cover-fallback">{meta.icon}</span>
      )}
    </span>
  );
}

function MediaContextMenu({ isLiked, item, menu, onAddQueue, onClose, onNotice, onPlayNext, onToggleLike }) {
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => onClose();
    const closeOnEscape = (event) => { if (event.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const playNext = () => {
    onClose();
    onPlayNext?.(item)
      ?.then(() => onNotice?.(`“${item.title}” will play next.`))
      ?.catch((error) => onNotice?.(error.message));
  };

  const addToQueue = () => {
    onClose();
    onAddQueue?.(item)
      ?.then(() => onNotice?.(`“${item.title}” is in the queue.`))
      ?.catch((error) => onNotice?.(error.message));
  };

  const toggleFavorite = () => {
    onClose();
    onToggleLike?.(item)
      ?.then((liked) => onNotice?.(`“${item.title}” ${liked ? "was added to" : "was removed from"} favorites.`))
      ?.catch((error) => onNotice?.(error.message));
  };

  return createPortal(
    <div
      role="menu"
      onClick={(event) => event.stopPropagation()}
      style={{
        position: "fixed",
        left: menu.x,
        top: menu.y,
        zIndex: 500,
        minWidth: 170,
        padding: 6,
        border: "1px solid var(--card-border)",
        borderRadius: 8,
        background: "var(--card-bg)",
        boxShadow: "0 12px 32px rgba(0,0,0,.25)",
      }}
    >
      <button type="button" role="menuitem" onClick={playNext} style={styles.contextMenuItem}>Play next</button>
      <button type="button" role="menuitem" onClick={addToQueue} style={styles.contextMenuItem}>Add to queue</button>
      {item.mime_type?.startsWith("audio/") && (
        <button type="button" role="menuitem" onClick={toggleFavorite} style={styles.contextMenuItem}>
          {isLiked ? "Remove from favorites" : "Add to favorites"}
        </button>
      )}
    </div>,
    document.body
  );
}

function openCardContextMenu(event, setMenu) {
  event.preventDefault();
  setMenu({
    x: Math.min(event.clientX, window.innerWidth - 180),
    y: Math.min(event.clientY, window.innerHeight - 145),
  });
}

function QuickAccessCard({ active, isLiked, item, onAddQueue, onNotice, onPlay, onPlayNext, onToggleLike }) {
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  return (
    <>
      <button
        type="button"
        className={`quick-access-card${active ? " quick-access-card--active" : ""}`}
        onClick={() => onPlay(item)}
        onContextMenu={(event) => openCardContextMenu(event, setMenu)}
      >
        <MediaCover item={item} size="small" />
        <span className="quick-access-copy">
          <strong title={item.title}>{item.title}</strong>
          <small>{mediaCategory(item)}</small>
        </span>
      </button>
      <MediaContextMenu
        isLiked={isLiked}
        item={item}
        menu={menu}
        onAddQueue={onAddQueue}
        onClose={closeMenu}
        onNotice={onNotice}
        onPlayNext={onPlayNext}
        onToggleLike={onToggleLike}
      />
    </>
  );
}

function FeaturedPanel({ item, onAddQueue, onPlay, onPlayNext }) {
  if (!item) return null;
  const description = item.description?.trim();

  return (
    <section className="library-featured">
      <div className="library-featured-copy">
        <h1>{item.title}</h1>
        {description && <p>{description}</p>}
        <div className="library-featured-actions">
          <button type="button" className="library-action library-action--primary" onClick={() => onPlay(item)}>
            <FontAwesomeIcon icon={faPlay} />
            Play
          </button>
          <button type="button" className="library-action" onClick={() => onPlayNext?.(item)}>
            <FontAwesomeIcon icon={faList} />
            Play next
          </button>
          <button type="button" className="library-action" onClick={() => onAddQueue?.(item)}>
            <FontAwesomeIcon icon={faPlus} />
            Queue
          </button>
        </div>
      </div>
      <div className="library-featured-art">
        <MediaCover item={item} size="hero" />
      </div>
    </section>
  );
}

function RowCard({ active, isLiked, item, onAddQueue, onNotice, onPlay, onPlayNext, onToggleLike, type }) {
  const [menu, setMenu] = useState(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const meta = getMimeMeta(item.mime_type);
  const circular = type === "profile" || type === "radio";
  return (
    <>
      <button
        type="button"
        className={`library-row-card library-row-card--${type}${active ? " library-row-card--active" : ""}`}
        onClick={() => onPlay(item)}
        onContextMenu={(event) => openCardContextMenu(event, setMenu)}
      >
        <MediaCover circular={circular} item={item} size={type === "playlist" ? "wide" : "regular"} />
        <span className="library-row-card-copy">
          <strong title={item.title}>{item.title}</strong>
          <small>{type === "radio" ? "Station" : item.artists || mediaCategory(item) || meta.label}</small>
        </span>
      </button>
      <MediaContextMenu
        isLiked={isLiked}
        item={item}
        menu={menu}
        onAddQueue={onAddQueue}
        onClose={closeMenu}
        onNotice={onNotice}
        onPlayNext={onPlayNext}
        onToggleLike={onToggleLike}
      />
    </>
  );
}

function ContentRow({ activeId, isLiked, items, onAddQueue, onNotice, onPlay, onPlayNext, onToggleLike, title, type = "square" }) {
  if (items.length === 0) return null;

  return (
    <section className="library-content-section">
      <div className="library-section-header">
        <h2>{title}</h2>
        <button type="button">
          Show All
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      </div>
      <div className="library-card-row" tabIndex={0}>
        {items.map((item) => (
          <RowCard
            key={`${title}-${item.id}`}
            active={Number(activeId) === Number(item.id)}
            isLiked={isLiked?.(item.id) || false}
            item={item}
            onAddQueue={onAddQueue}
            onNotice={onNotice}
            onPlay={onPlay}
            onPlayNext={onPlayNext}
            onToggleLike={onToggleLike}
            type={type}
          />
        ))}
      </div>
    </section>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "var(--bg)",
    color: "var(--text)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "0 24px",
    minHeight: "var(--app-header-height)",
    borderBottom: "1px solid var(--card-border)",
    background: "var(--card-bg)",
    position: "sticky",
    top: 0,
    zIndex: 100,
    flexWrap: "wrap",
  },
  headerBlock: {
    display: "flex",
    alignItems: "center",
    flex: "1 1 320px",
    maxWidth: 560,
    minWidth: 0,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    fontSize: "var(--fs-sm)",
  },
  navLink: {
    color: "var(--primary)",
    textDecoration: "none",
    fontWeight: 700,
    padding: "0.625rem 0.875rem",
    borderRadius: 10,
    border: "1px solid var(--card-border)",
    background: "var(--bg)",
    cursor: "pointer",
    transition: "opacity 0.15s",
    fontSize: "var(--fs-sm)",
  },
  contextMenuItem: {
    width: "100%",
    padding: "9px 11px",
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "var(--text)",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 700,
  },
  tierbadge: {
    fontSize: "var(--fs-xs)",
    color: "var(--text)",
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid var(--card-border)",
    background: "var(--bg)",
    fontWeight: 700,
  },
  main: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "1.75rem 1.25rem 2.5rem",
    display: "grid",
    gap: 18,
  },
  mainWithPlayer: {
    paddingBottom: "calc(var(--player-height) + 38px)",
  },
  sectionTitle: {
    fontSize: "var(--fs-sm)",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--muted)",
    marginBottom: 12,
    marginTop: 0,
  },
  tableCard: {
    border: "1px solid var(--card-border)",
    borderRadius: 16,
    background: "var(--card-bg)",
    overflow: "hidden",
  },
  tableHeader: {
    padding: "18px 20px 14px",
    borderBottom: "1px solid var(--card-border)",
  },
  cardTitle: {
    margin: 0,
    fontSize: "var(--fs-md)",
    fontWeight: 800,
    color: "var(--text)",
  },
  cardSubtitle: {
    marginTop: 4,
    marginBottom: 0,
    fontSize: "var(--fs-xs)",
    color: "var(--muted)",
  },
  cardBodyPanel: {
    padding: 20,
  },
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginTop: 20,
    flexWrap: "wrap",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "18px 20px",
    border: "1px solid var(--card-border)",
    borderRadius: 16,
    background: "linear-gradient(180deg, var(--card-bg), var(--bg))",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.04)",
    flexWrap: "wrap",
  },
  toolbarLabel: {
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--muted)",
    marginBottom: 4,
    fontWeight: 700,
  },
  toolbarValue: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text)",
    lineHeight: 1.3,
    wordBreak: "break-word",
  },
  toolbarMeta: {
    marginTop: 4,
    fontSize: 12,
    color: "var(--muted)",
  },
  tableWrap: {
    overflowX: "auto",
  },
  categoryBar: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 4,
  },
  cardTitle: {
    fontWeight: 600,
    fontSize: "var(--fs-sm)",
    marginBottom: 4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "var(--fs-sm)",
  },
  th: {
    textAlign: "left",
    padding: "12px 16px",
    borderBottom: "1px solid var(--table-border)",
    fontWeight: 700,
    fontSize: "var(--fs-xs)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--muted)",
  },
  td: {
    padding: "12px 16px",
    borderBottom: "1px solid var(--table-border-light)",
    verticalAlign: "middle",
  },
  ipBadge: {
    fontFamily: "monospace",
    fontSize: "var(--fs-xs)",
    background: "var(--code-bg)",
    border: "1px solid var(--code-border)",
    padding: "2px 6px",
    borderRadius: 4,
  },
  statusDot: (action) => ({
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: action === "play" ? "#27ae60" : "#888",
    marginRight: 6,
    verticalAlign: "middle",
  }),
  stateBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "1px 6px",
    borderRadius: 999,
    border: "1px solid var(--card-border)",
    color: "var(--muted)",
    fontSize: "var(--fs-xs)",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  nowPlayingSection: {
    display: "grid",
    gap: 12,
  },
  nowPlayingHeader: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  nowPlayingGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 12,
  },
  nowPlayingCard: {
    display: "grid",
    gap: 12,
    minWidth: 0,
    padding: 14,
    border: "1px solid var(--card-border)",
    borderRadius: 8,
    background: "var(--card-bg)",
    boxShadow: "0 10px 28px rgba(0, 0, 0, 0.06)",
  },
  nowPlayingCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minWidth: 0,
  },
  nowPlayingTitle: {
    margin: 0,
    overflow: "hidden",
    color: "var(--text)",
    fontSize: "var(--fs-md)",
    fontWeight: 800,
    lineHeight: 1.25,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  nowPlayingStatus: (action) => ({
    display: "inline-flex",
    flex: "0 0 auto",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    borderRadius: 999,
    background: action === "play" ? "rgba(39, 174, 96, 0.14)" : "var(--bg)",
    color: action === "play" ? "#16834a" : "var(--muted)",
    fontSize: "var(--fs-xs)",
    fontWeight: 800,
    textTransform: "capitalize",
  }),
  nowPlayingMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minWidth: 0,
    color: "var(--muted)",
    fontSize: "var(--fs-xs)",
  },
  nowPlayingProgress: {
    display: "grid",
    gap: 6,
  },
  nowPlayingProgressTrack: {
    height: 7,
    overflow: "hidden",
    borderRadius: 999,
    background: "var(--bg)",
    border: "1px solid var(--card-border)",
  },
  nowPlayingProgressFill: (percent) => ({
    width: `${percent}%`,
    height: "100%",
    borderRadius: 999,
    background: "var(--primary)",
    transition: "width 900ms linear",
  }),
  nowPlayingBadges: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  warningBanner: {
    background: "var(--warning-bg)",
    border: "1px solid var(--warning-border)",
    color: "var(--warning-text)",
    borderRadius: 8,
    padding: "12px 16px",
    marginBottom: 20,
    fontSize: "var(--fs-sm)",
  },
  emptyState: {
    textAlign: "center",
    padding: "60px 24px",
    color: "var(--muted)",
  },
  miniPlayer: {
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 180,
    minHeight: 82,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.15fr) auto minmax(110px, 0.85fr)",
    alignItems: "center",
    gap: 10,
    padding: "10px 84px 10px 12px",
    background: "var(--card-bg)",
    borderTop: "1px solid var(--card-border)",
    boxShadow: "0 -10px 30px rgba(0,0,0,0.16)",
  },
  miniTrack: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
    border: "none",
    background: "transparent",
    color: "var(--text)",
    padding: 0,
    textAlign: "left",
    cursor: "pointer",
  },
  miniThumb: {
    width: 56,
    height: 56,
    flex: "0 0 auto",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg)",
    border: "1px solid var(--card-border)",
  },
  miniTitle: {
    fontSize: 14,
    fontWeight: 700,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  miniMeta: {
    marginTop: 3,
    fontSize: 12,
    color: "var(--muted)",
  },
  playerControls: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  iconButton: (emphasis = false) => ({
    width: emphasis ? 42 : 34,
    height: emphasis ? 42 : 34,
    borderRadius: "50%",
    border: "1px solid var(--card-border)",
    background: emphasis ? "var(--primary)" : "var(--bg)",
    color: emphasis ? "#fff" : "var(--text)",
    cursor: "pointer",
    fontSize: emphasis ? 18 : 15,
    fontWeight: 700,
    lineHeight: 1,
  }),
  playerProgress: {
    display: "grid",
    gridTemplateColumns: "42px minmax(90px, 1fr) 42px",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    color: "var(--muted)",
  },
  range: {
    width: "100%",
    accentColor: "var(--primary)",
  },
  hiddenMedia: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: "none",
  },
};

export default function Dashboard() {
  const { tier, firstRun } = useAccess();
  const { categories, categoriesLoading } = useLibrary();
  const player = useGlobalPlayer();
  const [searchParams] = useSearchParams();
  const [media, setMedia] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [showEmptyGuide, setShowEmptyGuide] = useState(true);
  const [nowPlaying, setNowPlaying] = useState([]);
  const [shareEnabled, setShareEnabled] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [mediaSearch, setMediaSearch] = useState("");
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [nowPlayingRenderNow, setNowPlayingRenderNow] = useState(() => Date.now());

  const libraryView = searchParams.get("view") === "liked" ? "liked" : "all";
  const categoryParam = searchParams.get("category");
  const selectedCategory = categoryParam && /^\d+$/.test(categoryParam) ? categoryParam : null;
  const playMediaAction = player?.playMedia;
  const currentMediaId = player?.currentMedia?.id;

  useEffect(() => {
    setMediaSearch("");
  }, [libraryView, selectedCategory]);

  useEffect(() => {
    let cancelled = false;
    setMediaLoading(true);
    if (libraryView === "liked") {
      api("/api/likes")
        .then((r) => r.json())
        .then((items) => { if (!cancelled) setMedia(items); })
        .catch(() => { if (!cancelled) setNotice("Could not load favorites."); })
        .finally(() => {
          if (!cancelled) {
            setLoaded(true);
            setMediaLoading(false);
          }
        });
      return () => { cancelled = true; };
    }
    const url = selectedCategory
      ? `/api/media?category_id=${selectedCategory}`
      : "/api/media";
    api(url)
      .then((r) => r.json())
      .then((items) => { if (!cancelled) setMedia(items); })
      .catch(() => { if (!cancelled) setNotice("Could not load media."); })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true);
          setMediaLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCategory, libraryView]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api("/api/likes/share")
      .then((response) => response.json())
      .then((data) => setShareEnabled(Boolean(data.enabled)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ view: libraryView });
    if (selectedCategory) params.set("category_id", selectedCategory);

    api(`/api/playback/dashboard?${params.toString()}`)
      .then((response) => {
        if (!response.ok) throw new Error("Dashboard summary failed");
        return response.json();
      })
      .then((summary) => {
        if (!cancelled) setDashboardSummary(summary);
      })
      .catch(() => {
        if (!cancelled) setDashboardSummary(null);
      });

    return () => { cancelled = true; };
  }, [libraryView, selectedCategory]);

  useEffect(() => {
    if (tier < 100) return;
    const poll = () => {
      api("/api/playback/now-playing")
        .then((r) => r.json())
        .then((sessions) => {
          setNowPlaying(sessions);
          setNowPlayingRenderNow(Date.now());
        })
        .catch(() => {});
    };
    poll();
    const iv = setInterval(poll, NOW_PLAYING_POLL_MS);
    return () => clearInterval(iv);
  }, [tier]);

  useEffect(() => {
    if (tier < 100 || nowPlaying.length === 0) return undefined;

    const tick = setInterval(() => {
      setNowPlayingRenderNow(Date.now());
    }, NOW_PLAYING_TICK_MS);

    return () => clearInterval(tick);
  }, [nowPlaying.length, tier]);

  const isEmpty = loaded && !categoriesLoading && categories.length === 0 && media.length === 0;
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [String(category.id), category])),
    [categories]
  );
  const selectedCategoryInfo = selectedCategory != null
    ? categoryById.get(String(selectedCategory))
    : null;
  const mediaCategories = useMemo(
    () => categories.filter((category) => Number(category.media_count) > 0),
    [categories]
  );
  const mediaTitle = libraryView === "liked"
    ? "Favorites"
    : selectedCategoryInfo?.path || selectedCategoryInfo?.name || "All Media";
  const normalizedSearch = mediaSearch.trim().toLocaleLowerCase();
  const visibleMedia = useMemo(() => {
    if (!normalizedSearch) return media;

    return media.filter((item) => [
      item.title,
      item.artists,
      item.description,
      item.category_name,
      item.category_path,
      item.mime_type,
    ].some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedSearch)));
  }, [media, normalizedSearch]);
  const visibleMediaById = useMemo(
    () => new Map(visibleMedia.map((item) => [Number(item.id), item])),
    [visibleMedia]
  );
  const orderMediaByIds = useCallback((ids = [], fallbackItems = visibleMedia, limit = 14) => {
    const seen = new Set();
    const ordered = [];

    for (const id of ids) {
      const item = visibleMediaById.get(Number(id));
      if (!item || seen.has(Number(item.id))) continue;
      seen.add(Number(item.id));
      ordered.push(item);
      if (ordered.length >= limit) return ordered;
    }

    for (const item of fallbackItems) {
      if (!item || seen.has(Number(item.id))) continue;
      seen.add(Number(item.id));
      ordered.push(item);
      if (ordered.length >= limit) return ordered;
    }

    return ordered;
  }, [visibleMedia, visibleMediaById]);
  const featuredMedia = visibleMediaById.get(Number(dashboardSummary?.featuredId)) || visibleMedia[0] || media[0] || null;
  const quickAccessMedia = orderMediaByIds(dashboardSummary?.quickAccessIds, visibleMedia, 8);
  const fallbackRows = useMemo(() => [
    { title: "Recently added", type: "square", items: visibleMedia.slice(0, 14) },
  ], [visibleMedia]);
  const libraryRows = useMemo(() => {
    if (!Array.isArray(dashboardSummary?.rows) || dashboardSummary.rows.length === 0) return fallbackRows;

    const hiddenRows = new Set([
      "Artists and voices",
      "Playlists from this view",
      "Podcast-style listens",
      "Video stations",
      "Photo shelf",
    ]);
    return dashboardSummary.rows
      .filter((row) => !hiddenRows.has(row.title))
      .map((row, index) => ({
        title: row.title || fallbackRows[index]?.title || "Media",
        type: row.type || fallbackRows[index]?.type || "square",
        items: orderMediaByIds(row.mediaIds, fallbackRows[index]?.items || visibleMedia, 14),
      }));
  }, [dashboardSummary, fallbackRows, orderMediaByIds, visibleMedia]);

  const playMedia = useCallback((item) => {
    playMediaAction?.(item, libraryView === "liked" ? null : selectedCategory);
  }, [libraryView, playMediaAction, selectedCategory]);

  const createShare = useCallback(() => {
    api("/api/likes/share", { method: "POST" })
      .then((response) => response.json())
      .then((data) => {
        const url = `${window.location.origin}/shared/likes/${data.token}`;
        setShareEnabled(true);
        setShareUrl(url);
        setNotice("A new secret link was generated. The previous link no longer works.");
      })
      .catch(() => setNotice("Could not generate a share link."));
  }, []);

  const revokeShare = useCallback(() => {
    api("/api/likes/share", { method: "DELETE" })
      .then(() => {
        setShareEnabled(false);
        setShareUrl("");
        setNotice("Sharing has been revoked.");
      })
      .catch(() => setNotice("Could not revoke sharing."));
  }, []);

  return (
    <div className="premium-app-shell" style={styles.page}>
      {/* ── Empty Guide Modal ── */}
      {isEmpty && showEmptyGuide && (
        <div
          className="premium-modal-overlay"
          style={{
            position: "fixed", inset: 0, zIndex: 600,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--modal-overlay)",
          }}
          onClick={() => setShowEmptyGuide(false)}
        >
          <div
            style={{
              background: "var(--modal-bg)", color: "var(--modal-text)",
              borderRadius: 14, padding: "32px 28px",
              maxWidth: 520, width: "90%",
              boxShadow: "var(--modal-shadow)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, fontSize: 20, fontWeight: 700 }}>
              Start Your Multimedia Collection
            </h2>
            {firstRun && (
              <p style={{ background: "var(--warning-bg)", color: "var(--warning-text)", padding: "8px 12px", borderRadius: 6, marginTop: 8 }}>
                Your IP has been auto-whitelisted with admin access.
              </p>
            )}
            <p style={{ marginTop: 12 }}>No categories or media found yet. This server is a blank slate.</p>
            {tier >= 100 ? (
              <>
                <p style={{ marginTop: 12 }}><strong>Create a category from the server host:</strong></p>
                <pre style={{ background: "var(--code-bg)", border: "1px solid var(--code-border)", borderRadius: 6, padding: "10px 14px", fontSize: 12, overflowX: "auto", marginTop: 6 }}>
                  curl -X POST http://localhost:3001/api/categories \<br />
                  {"  "}-H 'Content-Type: application/json' \<br />
                  {"  "}-d '{`{"name":"Movies","min_access_tier":0}`}'
                </pre>
                <p style={{ marginTop: 12 }}>
                  Or use the{" "}
                  <Link to="/admin" style={{ color: "var(--primary)" }}>Admin page</Link>{" "}
                  to upload via the web UI.
                </p>
              </>
            ) : (
              <p style={{ marginTop: 12 }}>Contact an administrator with tier 100+ to add content.</p>
            )}
            <button
              onClick={() => setShowEmptyGuide(false)}
              style={{ marginTop: 20, padding: "8px 20px", cursor: "pointer", background: "transparent", border: "1px solid var(--card-border)", borderRadius: 8, color: "var(--text)", fontSize: 14 }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className="app-header dashboard-header" style={styles.header}>
        <div style={styles.headerBlock}>
          <MediaSearch
            value={mediaSearch}
            placeholder={`Search ${mediaTitle}...`}
            onChange={setMediaSearch}
            onClear={() => setMediaSearch("")}
          />
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="app-main" style={{ ...styles.main, ...(player?.currentMedia ? styles.mainWithPlayer : {}) }}>
        {notice && (
          <div style={styles.warningBanner} role="status">
            {notice}
            <button type="button" onClick={() => setNotice("")} style={{ float: "right", border: "none", background: "transparent", color: "inherit", cursor: "pointer" }}>×</button>
          </div>
        )}
        {firstRun && (
          <div style={styles.warningBanner}>
            <strong>First-time setup:</strong> Your IP has been automatically whitelisted with admin access.
          </div>
        )}

        <nav className="library-top-nav" aria-label="Library filters">
          <div className="library-filter-pills">
            <Link className={`library-filter-pill${!selectedCategory && libraryView !== "liked" ? " library-filter-pill--active" : ""}`} to="/">All</Link>
            <Link className={`library-filter-pill${libraryView === "liked" ? " library-filter-pill--active" : ""}`} to="/?view=liked">
              <FontAwesomeIcon icon={faBookmark} />
              Favorites
            </Link>
            {mediaCategories.slice(0, 10).map((category) => (
              <Link
                key={category.id}
                className={`library-filter-pill${String(category.id) === String(selectedCategory) ? " library-filter-pill--active" : ""}`}
                to={`/?category=${category.id}`}
              >
                {category.name}
              </Link>
            ))}
          </div>
          <span className="library-nav-count">
            {visibleMedia.length} item{visibleMedia.length === 1 ? "" : "s"}
          </span>
        </nav>

        {libraryView === "liked" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={styles.navLink} onClick={createShare}>{shareEnabled ? "Regenerate secret link" : "Share favorites"}</button>
            {shareEnabled && <button type="button" style={styles.navLink} onClick={revokeShare}>Revoke sharing</button>}
          </div>
        )}
        {libraryView === "liked" && shareUrl && (
          <div style={{ ...styles.tableCard, padding: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input readOnly value={shareUrl} aria-label="Secret share link" style={{ flex: "1 1 320px", padding: 9, border: "1px solid var(--card-border)", borderRadius: 7, background: "var(--bg)", color: "var(--text)" }} />
            <button type="button" style={styles.navLink} onClick={() => navigator.clipboard?.writeText(shareUrl).then(() => setNotice("Secret link copied."))}>Copy</button>
          </div>
        )}

        {mediaLoading ? (
          <MediaGridSkeleton />
        ) : visibleMedia.length > 0 ? (
          <div className="library-home">
            <section className="quick-access-section" aria-label="Quick access">
              {quickAccessMedia.map((item) => (
                <QuickAccessCard
                  key={item.id}
                  active={Number(currentMediaId) === Number(item.id)}
                  isLiked={player?.isLiked?.(item.id) || false}
                  item={item}
                  onAddQueue={player?.addToQueue}
                  onNotice={setNotice}
                  onPlay={playMedia}
                  onPlayNext={player?.playNext}
                  onToggleLike={player?.toggleLike}
                />
              ))}
            </section>

            <FeaturedPanel
              item={featuredMedia}
              onAddQueue={(item) => player?.addToQueue?.(item)?.then(() => setNotice(`“${item.title}” is in the queue.`)).catch((error) => setNotice(error.message))}
              onPlay={playMedia}
              onPlayNext={(item) => player?.playNext?.(item)?.then(() => setNotice(`“${item.title}” will play next.`)).catch((error) => setNotice(error.message))}
            />

            {libraryRows.map((row) => (
              <ContentRow
                key={row.title}
                activeId={currentMediaId}
                isLiked={player?.isLiked}
                items={row.items}
                onAddQueue={player?.addToQueue}
                onNotice={setNotice}
                onPlay={playMedia}
                onPlayNext={player?.playNext}
                onToggleLike={player?.toggleLike}
                title={row.title}
                type={row.type}
              />
            ))}
          </div>
        ) : media.length > 0 && normalizedSearch ? (
          <div style={styles.emptyState} role="status">
            <EmptySearchMark />
            <p>No media matches “{mediaSearch.trim()}”.</p>
            <button type="button" style={styles.navLink} onClick={() => setMediaSearch("")}>Clear search</button>
          </div>
        ) : loaded && (
          <div style={styles.emptyState}>
            <EmptyLibraryMark />
            <p>No media yet in this category.</p>
          </div>
        )}

        {/* Now Playing (Admin) */}
        {tier >= 100 && nowPlaying.length > 0 && (
          <section style={styles.nowPlayingSection}>
            <div style={styles.nowPlayingHeader}>
              <div>
                <h2 style={{ ...styles.sectionTitle, marginBottom: 4 }}>Now Playing</h2>
                <p style={styles.cardSubtitle}>Active playback sessions on this server.</p>
              </div>
              <span style={styles.tierbadge}>
                {nowPlaying.length} active
              </span>
            </div>
            <div style={styles.nowPlayingGrid}>
              {nowPlaying.map((s, i) => {
                const stateLabels = playbackStateLabels(s);
                const displayPosition = playbackDisplayPosition(s, nowPlayingRenderNow);
                const progressPercent = playbackProgressPercent(displayPosition, s.duration);
                const title = s.title || `Media #${s.mediaId}`;

                return (
                  <article key={`${s.ip}-${s.mediaId}-${i}`} style={styles.nowPlayingCard}>
                    <div style={styles.nowPlayingCardHeader}>
                      <span style={styles.ipBadge}>{s.ip}</span>
                      <span style={styles.nowPlayingStatus(s.action)}>
                        <span style={styles.statusDot(s.action)} />
                        {s.action}
                      </span>
                    </div>
                    <div>
                      <h3 aria-label={title} style={styles.nowPlayingTitle} className="now-playing-card-title">
                        {title}
                      </h3>
                      <p style={styles.cardSubtitle}>Media #{s.mediaId}</p>
                    </div>
                    <div style={styles.nowPlayingProgress}>
                      <div style={styles.nowPlayingMeta}>
                        <span>{fmtDur(displayPosition)}</span>
                        <span>{fmtDur(s.duration)}</span>
                      </div>
                      <div style={styles.nowPlayingProgressTrack} aria-hidden="true">
                        <div style={styles.nowPlayingProgressFill(progressPercent)} />
                      </div>
                    </div>
                    {stateLabels.length > 0 && (
                      <div style={styles.nowPlayingBadges}>
                        {stateLabels.map((label) => (
                          <span key={label} style={styles.stateBadge}>{label}</span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>

    </div>
  );
}

function fmtDur(s) {
  const seconds = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function playbackDisplayPosition(session, nowMs) {
  const position = Math.max(0, Math.floor(Number(session.position) || 0));
  const duration = Math.max(0, Math.floor(Number(session.duration) || 0));

  if (session.action !== "play" || duration <= 0) return position;

  const timestampMs = Date.parse(session.timestamp);
  if (!Number.isFinite(timestampMs)) return Math.min(position, duration);

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  return Math.min(position + elapsedSeconds, duration);
}

function playbackProgressPercent(position, duration) {
  const current = Number(position) || 0;
  const total = Number(duration) || 0;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}
