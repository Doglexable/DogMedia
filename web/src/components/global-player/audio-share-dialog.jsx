import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons/faCheck";
import { faCopy } from "@fortawesome/free-solid-svg-icons/faCopy";
import { faFilm } from "@fortawesome/free-solid-svg-icons/faFilm";
import { faLinkSlash } from "@fortawesome/free-solid-svg-icons/faLinkSlash";
import { faQuoteRight } from "@fortawesome/free-solid-svg-icons/faQuoteRight";
import { faShareNodes } from "@fortawesome/free-solid-svg-icons/faShareNodes";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { api } from "../../api";
import {
  ACTIVE_STATUSES,
  absoluteShareUrl,
  clampClipStart,
  copyTextToClipboard,
  formatClipTime,
  reelTokenKey,
} from "./music-share-dialog";
import {
  createLyricsSelection,
  getLyricsCandidateWindow,
  getLyricsShareIndex,
  getLyricsShareMetadata,
  getSelectedLyrics,
  LYRICS_CARD,
  sanitizeLyricsFilename,
  shareLyricsBlob,
  updateLyricsSelection,
} from "./lyrics-share";
import { LyricsShareCard } from "./lyrics-card-preview";

async function waitForCardAssets(cardElement) {
  if (!cardElement) return;
  const images = Array.from(cardElement.querySelectorAll("img"));
  await Promise.all(
    images.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    })
  );
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Font loading failure shouldn't prevent card capture
    }
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

function scrollActiveLineIntoView(container, element) {
  if (!container || !element) return;
  const top =
    element.offsetTop -
    container.offsetTop -
    container.clientHeight / 2 +
    element.clientHeight / 2;
  container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

export function AudioShareDialog({
  artworkUrl = null,
  currentMedia,
  duration = 0,
  initialPosition = 0,
  initialTab = "auto",
  lyrics: propLyrics,
  lyricsLoading = false,
  onClose,
}) {
  const mediaId = Number(currentMedia?.id);
  const trackDuration = Number(duration || currentMedia?.duration || 0);
  const maxClipStart = Math.max(0, trackDuration - 10);

  // Fallback internal lyrics fetch if lyrics were not passed as prop
  const [internalLyrics, setInternalLyrics] = useState(null);
  const [internalLyricsLoading, setInternalLyricsLoading] = useState(false);

  useEffect(() => {
    if (propLyrics !== undefined || !mediaId) return undefined;
    const controller = new AbortController();
    setInternalLyricsLoading(true);
    api(`/api/media/${mediaId}/lyrics`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json().catch(() => null);
        return Array.isArray(data?.segments) ? data : null;
      })
      .then((data) => setInternalLyrics(data))
      .catch(() => setInternalLyrics(null))
      .finally(() => {
        if (!controller.signal.aborted) setInternalLyricsLoading(false);
      });
    return () => controller.abort();
  }, [mediaId, propLyrics]);

  const effectiveLyrics = propLyrics !== undefined ? propLyrics : internalLyrics;
  const isLyricsLoading = propLyrics !== undefined ? lyricsLoading : internalLyricsLoading;
  const segments = useMemo(
    () => (Array.isArray(effectiveLyrics?.segments) ? effectiveLyrics.segments : []),
    [effectiveLyrics?.segments]
  );
  const hasLyrics = segments.length > 0;

  // Active Tab state
  const [tab, setTab] = useState(() => {
    if (initialTab === "lyrics") return "lyrics";
    if (initialTab === "clip") return "clip";
    // "auto" or unspecified: lyric card if lyrics exist, otherwise clip
    return hasLyrics ? "lyrics" : "clip";
  });

  // Automatically update tab from "auto" once lyrics load
  useEffect(() => {
    if (initialTab === "auto" && !hasLyrics && !isLyricsLoading) {
      setTab("clip");
    }
  }, [hasLyrics, initialTab, isLyricsLoading]);

  // ── Lyrics Card State ──
  const anchorIndex = useMemo(
    () => getLyricsShareIndex(segments, initialPosition),
    [initialPosition, segments]
  );
  const [selection, setSelection] = useState(() =>
    createLyricsSelection(anchorIndex, segments.length)
  );
  const [sharingImage, setSharingImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const [artworkFailed, setArtworkFailed] = useState(false);
  const cardRef = useRef(null);
  const pickerRef = useRef(null);
  const pickerLineRefs = useRef([]);

  const metadata = useMemo(
    () => getLyricsShareMetadata(currentMedia, artworkUrl),
    [artworkUrl, currentMedia]
  );
  const selectedLyrics = useMemo(
    () => getSelectedLyrics(segments, selection),
    [segments, selection]
  );
  const selectionWindow = useMemo(
    () => getLyricsCandidateWindow(anchorIndex, segments.length),
    [anchorIndex, segments.length]
  );

  useEffect(() => {
    if (tab === "lyrics" && hasLyrics) {
      const frame = requestAnimationFrame(() => {
        scrollActiveLineIntoView(pickerRef.current, pickerLineRefs.current[anchorIndex]);
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [anchorIndex, hasLyrics, tab]);

  // ── 10s Music Clip State ──
  const [clipStart, setClipStart] = useState(() =>
    clampClipStart(initialPosition, trackDuration)
  );
  const [selectedLyricClipIndex, setSelectedLyricClipIndex] = useState(null);
  const [reel, setReel] = useState({ loading: true, enabled: false });
  const [shareUrl, setShareUrl] = useState("");
  const [clipBusy, setClipBusy] = useState(false);
  const [clipNotice, setClipNotice] = useState("");

  const applyReel = useCallback(
    (data) => {
      const reelMediaIds = Array.isArray(data?.mediaIds) ? data.mediaIds.map(Number) : [];
      if (data?.enabled && (reelMediaIds.length !== 1 || reelMediaIds[0] !== mediaId)) {
        setReel({ loading: false, enabled: false, replacing: true });
        setShareUrl("");
        return;
      }
      setReel({ loading: false, ...data });
      if (!data?.reelId) return;
      const token = data.token || window.sessionStorage.getItem(reelTokenKey(data.reelId));
      if (data.token) window.sessionStorage.setItem(reelTokenKey(data.reelId), data.token);
      if (token) setShareUrl(absoluteShareUrl(`/shared/music#${token}`));
    },
    [mediaId]
  );

  const readStatus = useCallback(() => {
    return api("/api/music-shares/current").then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not read reel status");
      applyReel(data);
      return data;
    });
  }, [applyReel]);

  useEffect(() => {
    let cancelled = false;
    readStatus().catch((error) => {
      if (!cancelled) setReel({ loading: false, enabled: false, error: error.message });
    });
    return () => {
      cancelled = true;
    };
  }, [readStatus]);

  useEffect(() => {
    if (!ACTIVE_STATUSES.has(reel.status)) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden") readStatus().catch(() => {});
    };
    const interval = window.setInterval(refreshWhenVisible, 2000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [readStatus, reel.status]);

  const createClipReel = async () => {
    if (!mediaId) {
      setClipNotice("This track cannot be shared.");
      return;
    }
    setClipBusy(true);
    setClipNotice("");
    try {
      const response = await api("/api/music-shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaIds: [mediaId],
          expiresInDays: 1,
          clipStarts: [clipStart],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not start the clip render");
      applyReel(data);
      setClipNotice("Rendering started. You can keep this open or come back later.");
    } catch (error) {
      setClipNotice(error.message);
    } finally {
      setClipBusy(false);
    }
  };

  const createReplacementLink = async () => {
    const response = await api("/api/music-shares/current/link", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not create a share link");
    applyReel(data);
    const url = absoluteShareUrl(data.sharePath);
    setShareUrl(url);
    return url;
  };

  const copyClipLink = async (providedUrl) => {
    try {
      const requestedUrl = typeof providedUrl === "string" ? providedUrl : shareUrl;
      const url = requestedUrl || (await createReplacementLink());
      const copied = await copyTextToClipboard(url);
      setClipNotice(
        copied ? "Link copied." : "Copy unavailable. Select and copy the link manually."
      );
    } catch (error) {
      setClipNotice(error.message || "Select and copy the link manually.");
    }
  };

  const shareClipLink = async () => {
    setClipBusy(true);
    try {
      const url = shareUrl || (await createReplacementLink());
      if (!navigator.share) {
        await copyClipLink(url);
        return;
      }
      await navigator.share({
        title: currentMedia?.title || "Dogmedia music clip",
        text: `A 10-second clip from ${currentMedia?.title || "this track"}`,
        url,
      });
    } catch (error) {
      if (error.name !== "AbortError") setClipNotice("The link could not be shared.");
    } finally {
      setClipBusy(false);
    }
  };

  const revokeClip = async () => {
    setClipBusy(true);
    try {
      const response = await api("/api/music-shares/current", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not revoke the clip");
      if (reel.reelId) window.sessionStorage.removeItem(reelTokenKey(reel.reelId));
      setReel({ loading: false, enabled: false });
      setShareUrl("");
      setClipNotice("The clip link has been revoked.");
    } catch (error) {
      setClipNotice(error.message);
    } finally {
      setClipBusy(false);
    }
  };

  // ── Share Lyric Image Handler ──
  const handleShareImage = useCallback(async () => {
    if (!cardRef.current || selectedLyrics.length === 0 || sharingImage) return;
    setSharingImage(true);
    setImageError("");
    try {
      await waitForCardAssets(cardRef.current);
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(cardRef.current, {
        backgroundColor: "#12131a",
        cacheBust: true,
        width: LYRICS_CARD.cssWidth,
        height: LYRICS_CARD.cssHeight,
        pixelRatio: LYRICS_CARD.pixelRatio,
        style: { transform: "none", borderRadius: "0" },
      });
      if (!blob) throw new Error("Image capture returned no data");
      await shareLyricsBlob(blob, {
        filename: sanitizeLyricsFilename(metadata.title),
        title: metadata.title,
      });
      onClose();
    } catch (err) {
      if (err?.name !== "AbortError") {
        setImageError("Could not create the lyrics card. Try sharing again.");
      }
    } finally {
      setSharingImage(false);
    }
  }, [metadata.title, onClose, selectedLyrics.length, sharingImage]);

  // ── Keyboard & Body Overflow Trap ──
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !sharingImage && !clipBusy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [clipBusy, onClose, sharingImage]);

  const clipRendering = ACTIVE_STATUSES.has(reel.status);
  const clipCanShare = reel.status === "ready";

  const dialogContent = (
    <div
      className="lyrics-share-overlay audio-share-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audio-share-title"
    >
      <button
        className="lyrics-share-dismiss"
        type="button"
        aria-label="Close share dialog"
        onClick={onClose}
      />
      <section className="lyrics-share-dialog audio-share-dialog">
        {/* Unified Header */}
        <header className="lyrics-share-dialog-header audio-share-header">
          <div className="audio-share-header-meta">
            <span>Share music</span>
            <h2 id="audio-share-title" className="truncate">
              {currentMedia?.title || "Audio"}
            </h2>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="audio-share-tabs" role="tablist" aria-label="Share format options">
            <button
              type="button"
              role="tab"
              id="audio-share-tab-lyrics"
              aria-selected={tab === "lyrics"}
              aria-controls="audio-share-panel-lyrics"
              className={`audio-share-tab ${tab === "lyrics" ? "audio-share-tab--active" : ""}`}
              disabled={!hasLyrics && !isLyricsLoading}
              onClick={() => setTab("lyrics")}
              title={hasLyrics ? "Share as image card" : "No timed lyrics available"}
            >
              <FontAwesomeIcon icon={faQuoteRight} />
              <span>Lyric Card</span>
              {hasLyrics && (
                <span className="audio-share-tab-badge">{selectedLyrics.length}/5</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              id="audio-share-tab-clip"
              aria-selected={tab === "clip"}
              aria-controls="audio-share-panel-clip"
              className={`audio-share-tab ${tab === "clip" ? "audio-share-tab--active" : ""}`}
              onClick={() => setTab("clip")}
              title="Share as 10-second video clip"
            >
              <FontAwesomeIcon icon={faFilm} />
              <span>10s Video Clip</span>
            </button>
          </div>

          <button
            autoFocus
            type="button"
            className="lyrics-share-close"
            aria-label="Close share dialog"
            onClick={onClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        {/* Tab 1: Lyric Card Content */}
        {tab === "lyrics" && (
          <div
            id="audio-share-panel-lyrics"
            role="tabpanel"
            aria-labelledby="audio-share-tab-lyrics"
            className="audio-share-tabpanel"
          >
            {isLyricsLoading ? (
              <div className="p-8 text-center text-muted">Loading lyrics…</div>
            ) : !hasLyrics ? (
              <div className="p-8 text-center text-muted">
                <p>No timed lyrics found for this track.</p>
                <button
                  type="button"
                  className="mt-4 px-4 py-2 rounded-lg bg-[var(--primary)] text-white font-bold text-xs"
                  onClick={() => setTab("clip")}
                >
                  Share 10s Clip Instead
                </button>
              </div>
            ) : (
              <div className="lyrics-share-layout">
                <div
                  ref={pickerRef}
                  className="lyrics-share-picker"
                  aria-label="Choose lyrics to share"
                >
                  {segments.map((segment, index) => {
                    const selectedLine =
                      selection && index >= selection.start && index <= selection.end;
                    const selectable =
                      index >= selectionWindow.start && index <= selectionWindow.end;
                    return (
                      <button
                        key={`${segment.start}-${index}`}
                        ref={(node) => {
                          pickerLineRefs.current[index] = node;
                        }}
                        type="button"
                        className={`lyrics-share-picker-line${selectedLine ? " lyrics-share-picker-line--selected" : ""}${!selectable ? " lyrics-share-picker-line--disabled" : ""}`}
                        aria-pressed={Boolean(selectedLine)}
                        disabled={!selectable}
                        onClick={() =>
                          setSelection((current) =>
                            updateLyricsSelection(current, index, segments.length)
                          )
                        }
                      >
                        {segment.text}
                      </button>
                    );
                  })}
                </div>
                <div className="lyrics-share-preview-shell">
                  <div className="lyrics-share-preview-frame">
                    <LyricsShareCard
                      artworkFailed={artworkFailed}
                      cardRef={cardRef}
                      metadata={metadata}
                      onArtworkError={() => setArtworkFailed(true)}
                      selected={selectedLyrics}
                    />
                  </div>
                </div>
              </div>
            )}

            {imageError && (
              <p className="lyrics-share-error" role="alert">
                {imageError}
              </p>
            )}

            <footer className="lyrics-share-actions">
              <span>{selectedLyrics.length}/5 lines selected</span>
              <button
                type="button"
                disabled={sharingImage || selectedLyrics.length === 0}
                onClick={handleShareImage}
              >
                <FontAwesomeIcon icon={faShareNodes} />{" "}
                {sharingImage ? "Creating card…" : "Share image"}
              </button>
            </footer>
          </div>
        )}

        {/* Tab 2: 10s Music Clip Content */}
        {tab === "clip" && (
          <div
            id="audio-share-panel-clip"
            role="tabpanel"
            aria-labelledby="audio-share-tab-clip"
            className="audio-share-tabpanel audio-share-clip-panel"
          >
            <div className="music-reel-builder p-5">
              {clipRendering || reel.status === "ready" || reel.status === "failed" ? (
                <div className="music-reel-processing" aria-live="polite">
                  <div className="music-reel-progress-copy">
                    <span>
                      {reel.status === "ready"
                        ? "Render complete"
                        : reel.status === "failed"
                          ? "Render stopped"
                          : "Preparing 10s video clip"}
                    </span>
                    <strong>{reel.progress || 0}%</strong>
                  </div>
                  <div
                    className="music-reel-progress"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={reel.progress || 0}
                  >
                    <span style={{ width: `${reel.progress || 0}%` }} />
                  </div>
                  {shareUrl && (
                    <div className="music-share-link-row">
                      <input
                        readOnly
                        value={shareUrl}
                        aria-label="Secret reel link"
                        onFocus={(event) => event.target.select()}
                      />
                      <button
                        type="button"
                        aria-label="Copy link"
                        onClick={() => copyClipLink(shareUrl)}
                      >
                        <FontAwesomeIcon icon={faCopy} />
                      </button>
                    </div>
                  )}
                  {reel.error && (
                    <p className="music-share-notice music-share-notice--error" role="alert">
                      {reel.error}
                    </p>
                  )}
                </div>
              ) : (
                <section
                  className="music-clip-picker"
                  aria-labelledby="audio-share-clip-picker-title"
                >
                  <div className="music-clip-picker-heading">
                    <div>
                      <span>Choose the moment</span>
                      <h3 id="audio-share-clip-picker-title">Your 10-second window</h3>
                    </div>
                    <strong>
                      {formatClipTime(clipStart)}–
                      {formatClipTime(
                        Math.min(trackDuration || clipStart + 10, clipStart + 10)
                      )}
                    </strong>
                  </div>
                  <div className="music-clip-window" aria-hidden="true">
                    <span
                      style={{
                        left: `${trackDuration ? (clipStart / trackDuration) * 100 : 0}%`,
                        width: `${trackDuration ? Math.min(100, (10 / trackDuration) * 100) : 100}%`,
                      }}
                    />
                  </div>
                  <input
                    className="music-clip-range"
                    type="range"
                    min="0"
                    max={maxClipStart}
                    step="0.1"
                    value={clipStart}
                    disabled={maxClipStart === 0}
                    aria-label="Clip start time"
                    aria-valuetext={`From ${formatClipTime(clipStart)} to ${formatClipTime(Math.min(trackDuration || clipStart + 10, clipStart + 10))}`}
                    onChange={(event) => {
                      setClipStart(clampClipStart(event.target.value, trackDuration));
                      setSelectedLyricClipIndex(null);
                    }}
                  />
                  <div className="music-clip-scale">
                    <span>0:00</span>
                    <span>{formatClipTime(trackDuration)}</span>
                  </div>

                  {/* Lyrics quick-seek */}
                  <div
                    className="music-clip-lyrics"
                    aria-label="Choose a lyric to align clip start"
                  >
                    {isLyricsLoading ? (
                      <p>Loading timed lyrics…</p>
                    ) : segments.length ? (
                      segments.map((segment, index) => (
                        <button
                          key={`${segment.start}-${index}`}
                          type="button"
                          className={selectedLyricClipIndex === index ? "is-selected" : ""}
                          aria-pressed={selectedLyricClipIndex === index}
                          onClick={() => {
                            setClipStart(
                              clampClipStart(Number(segment.start) - 2, trackDuration)
                            );
                            setSelectedLyricClipIndex(index);
                          }}
                        >
                          <time>{formatClipTime(segment.start)}</time>
                          <span>{segment.text || "Instrumental"}</span>
                        </button>
                      ))
                    ) : (
                      <p>No timed lyrics found. Drag the timeline to choose the start.</p>
                    )}
                  </div>
                </section>
              )}
              <p className="music-reel-retention">
                The rendered video and its private link are removed after 24 hours.
              </p>
            </div>

            {clipNotice && (
              <p className="music-share-notice mx-5" role="status">
                <FontAwesomeIcon icon={clipCanShare ? faCheck : faFilm} /> {clipNotice}
              </p>
            )}

            <footer className="music-share-footer">
              {reel.enabled && (
                <button
                  type="button"
                  className="music-share-revoke"
                  disabled={clipBusy}
                  onClick={revokeClip}
                >
                  <FontAwesomeIcon icon={faLinkSlash} /> Revoke
                </button>
              )}
              {!reel.enabled && (
                <button
                  type="button"
                  className="music-share-primary"
                  disabled={clipBusy || reel.loading}
                  onClick={createClipReel}
                >
                  <FontAwesomeIcon icon={faFilm} />{" "}
                  {clipBusy ? "Starting…" : "Render 10s clip"}
                </button>
              )}
              {clipCanShare && (
                <button
                  type="button"
                  className="music-share-primary"
                  disabled={clipBusy}
                  onClick={shareClipLink}
                >
                  <FontAwesomeIcon icon={faShareNodes} />{" "}
                  {clipBusy ? "Creating link…" : "Share clip link"}
                </button>
              )}
            </footer>
          </div>
        )}
      </section>
    </div>
  );

  if (typeof document === "undefined" || !document?.body) {
    return dialogContent;
  }

  return createPortal(dialogContent, document.body);
}

export default AudioShareDialog;
