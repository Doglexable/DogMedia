import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAccess } from "../App";
import { api } from "../api";
import { useGlobalPlayer } from "../components/GlobalPlayer";
import { useLibrary } from "../components/library-shell";
import { MediaSearch } from "../components/dashboard/media-search";

const MediaCard = lazy(() => import("../components/dashboard/media-card"));
const MEDIA_PAGE_SIZE = 24;

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
    marginLeft: 6,
    padding: "1px 6px",
    borderRadius: 999,
    border: "1px solid var(--card-border)",
    color: "var(--muted)",
    fontSize: "var(--fs-xs)",
    fontWeight: 700,
    whiteSpace: "nowrap",
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
  emptyIcon: { fontSize: 48, marginBottom: 12 },
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
  const { tier, description, firstRun, clientIp } = useAccess();
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
  const [mediaPage, setMediaPage] = useState(1);

  const libraryView = searchParams.get("view") === "liked" ? "liked" : "all";
  const categoryParam = searchParams.get("category");
  const selectedCategory = categoryParam && /^\d+$/.test(categoryParam) ? categoryParam : null;
  const playMediaAction = player?.playMedia;
  const toggleLikeAction = player?.toggleLike;
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
        .catch(() => { if (!cancelled) setNotice("Could not load liked music."); })
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
    if (tier < 100) return;
    const poll = () => {
      api("/api/playback/now-playing")
        .then((r) => r.json())
        .then(setNowPlaying)
        .catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 10000);
    return () => clearInterval(iv);
  }, [tier]);

  const isEmpty = loaded && !categoriesLoading && categories.length === 0 && media.length === 0;
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [String(category.id), category])),
    [categories]
  );
  const selectedCategoryInfo = selectedCategory != null
    ? categoryById.get(String(selectedCategory))
    : null;
  const visibleCategories = useMemo(
    () => categories.filter((category) => String(category.parent_id ?? "") === String(selectedCategory ?? "")),
    [categories, selectedCategory]
  );
  const mediaTitle = libraryView === "liked"
    ? "Liked Music"
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
  const mediaPageCount = Math.max(1, Math.ceil(visibleMedia.length / MEDIA_PAGE_SIZE));
  const currentMediaPage = Math.min(mediaPage, mediaPageCount);
  const pagedMedia = useMemo(() => {
    const start = (currentMediaPage - 1) * MEDIA_PAGE_SIZE;
    return visibleMedia.slice(start, start + MEDIA_PAGE_SIZE);
  }, [currentMediaPage, visibleMedia]);
  const firstVisibleMedia = visibleMedia.length === 0
    ? 0
    : (currentMediaPage - 1) * MEDIA_PAGE_SIZE + 1;
  const lastVisibleMedia = Math.min(currentMediaPage * MEDIA_PAGE_SIZE, visibleMedia.length);

  useEffect(() => {
    setMediaPage(1);
  }, [libraryView, normalizedSearch, selectedCategory]);

  useEffect(() => {
    setMediaPage((page) => Math.min(page, mediaPageCount));
  }, [mediaPageCount]);

  const playMedia = useCallback((item) => {
    playMediaAction?.(item, libraryView === "liked" ? null : selectedCategory);
  }, [libraryView, playMediaAction, selectedCategory]);

  const toggleLiked = useCallback((item) => {
    toggleLikeAction?.(item)
      .then((liked) => {
        if (!liked && libraryView === "liked") {
          setMedia((items) => items.filter((mediaItem) => Number(mediaItem.id) !== Number(item.id)));
        }
      })
      .catch((error) => setNotice(error.message));
  }, [libraryView, toggleLikeAction]);

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
        <div style={styles.headerActions} className="dashboard-header-actions">
          <span style={styles.tierbadge} className="dashboard-tier-badge">
            {description || `Tier ${tier}`}
            {clientIp && <span style={{ fontFamily: "monospace" }}> · {clientIp}</span>}
          </span>
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

        <section className="hero-surface dashboard-view-ambient" style={styles.toolbar}>
          <div className="dashboard-view-ambient-content">
            <div style={styles.toolbarLabel}>Current library view</div>
            <div style={styles.toolbarValue}>{mediaTitle}</div>
            <div style={styles.toolbarMeta}>
              {selectedCategoryInfo
                ? `${visibleCategories.length} child folder${visibleCategories.length === 1 ? "" : "s"} in this category`
                : `${categories.length} accessible categor${categories.length === 1 ? "y" : "ies"}`}
            </div>
          </div>
          <div className="dashboard-view-ambient-content" style={styles.toolbarMeta}>
            {visibleMedia.length} item{visibleMedia.length !== 1 ? "s" : ""} visible
          </div>
        </section>

        {libraryView === "liked" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={styles.navLink} onClick={createShare}>{shareEnabled ? "Regenerate secret link" : "Share liked music"}</button>
            {shareEnabled && <button type="button" style={styles.navLink} onClick={revokeShare}>Revoke sharing</button>}
          </div>
        )}
        {libraryView === "liked" && shareUrl && (
          <div style={{ ...styles.tableCard, padding: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input readOnly value={shareUrl} aria-label="Secret share link" style={{ flex: "1 1 320px", padding: 9, border: "1px solid var(--card-border)", borderRadius: 7, background: "var(--bg)", color: "var(--text)" }} />
            <button type="button" style={styles.navLink} onClick={() => navigator.clipboard?.writeText(shareUrl).then(() => setNotice("Secret link copied."))}>Copy</button>
          </div>
        )}

        {/* Media Grid */}
        <section className="glass-surface" style={styles.tableCard}>
          <div style={styles.tableHeader}>
            <h2 style={styles.cardTitle}>{mediaTitle}</h2>
            <p style={styles.cardSubtitle}>
              {normalizedSearch
                ? `${visibleMedia.length} of ${media.length} items match your search.`
                : `${media.length} item${media.length !== 1 ? "s" : ""} available in this view.`}
            </p>
          </div>
          <div style={styles.cardBodyPanel}>
            {mediaLoading ? (
              <MediaGridSkeleton />
            ) : visibleMedia.length > 0 ? (
              <div className="media-card-grid">
                {pagedMedia.map((m) => (
                  <Suspense key={m.id} fallback={<div className="media-card-skeleton" aria-hidden="true" />}>
                    <MediaCard
                      item={m}
                      isActive={currentMediaId === m.id}
                      isLiked={player?.isLiked(m.id)}
                      onAddQueue={player?.addToQueue}
                      onError={setNotice}
                      onPlay={playMedia}
                      onPlayNext={player?.playNext}
                      onToggleLike={toggleLiked}
                    />
                  </Suspense>
                ))}
              </div>
            ) : media.length > 0 && normalizedSearch ? (
              <div style={styles.emptyState} role="status">
                <div style={styles.emptyIcon}>🔎</div>
                <p>No media matches “{mediaSearch.trim()}”.</p>
                <button type="button" style={styles.navLink} onClick={() => setMediaSearch("")}>Clear search</button>
              </div>
            ) : loaded && (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>📂</div>
                <p>No media yet in this category.</p>
              </div>
            )}
            {!mediaLoading && visibleMedia.length > MEDIA_PAGE_SIZE && (
              <nav style={styles.pagination} aria-label="Media pages">
                <button
                  type="button"
                  style={styles.navLink}
                  disabled={currentMediaPage === 1}
                  onClick={() => setMediaPage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </button>
                <span style={styles.cardSubtitle} aria-live="polite">
                  {firstVisibleMedia}–{lastVisibleMedia} of {visibleMedia.length}
                </span>
                <button
                  type="button"
                  style={styles.navLink}
                  disabled={currentMediaPage === mediaPageCount}
                  onClick={() => setMediaPage((page) => Math.min(mediaPageCount, page + 1))}
                >
                  Next
                </button>
              </nav>
            )}
          </div>
        </section>

        {/* Now Playing (Admin) */}
        {tier >= 100 && nowPlaying.length > 0 && (
          <section className="glass-surface" style={styles.tableCard}>
            <div style={styles.tableHeader}>
              <h2 style={styles.cardTitle}>Now Playing</h2>
              <p style={styles.cardSubtitle}>Active playback sessions on this server.</p>
            </div>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>IP</th>
                    <th style={styles.th}>Media</th>
                    <th style={styles.th}>Position</th>
                    <th style={styles.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {nowPlaying.map((s, i) => {
                    const stateLabels = playbackStateLabels(s);
                    return (
                      <tr key={i}>
                        <td style={styles.td}><span style={styles.ipBadge}>{s.ip}</span></td>
                        <td style={styles.td}>{s.title || `Media #${s.mediaId}`}</td>
                        <td style={styles.td}>{fmtDur(s.position)} / {fmtDur(s.duration)}</td>
                        <td style={styles.td}>
                          <span style={styles.statusDot(s.action)} />
                          {s.action}
                          {stateLabels.map((label) => (
                            <span key={label} style={styles.stateBadge}>{label}</span>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

    </div>
  );
}

function fmtDur(s) {
  if (!s) return "0:00";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
