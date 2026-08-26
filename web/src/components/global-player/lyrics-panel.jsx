import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faQuoteRight, faShareNodes, faXmark } from "@fortawesome/free-solid-svg-icons";
import { Drawer } from "vaul";
import { api } from "../../api";
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

export function findActiveLyricsIndex(segments, position) {
  if (!Array.isArray(segments) || !Number.isFinite(position)) return -1;
  return segments.findIndex((segment) => position >= segment.start && position <= segment.end);
}

export function getLyricsScrollBehavior(prefersReducedMotion) {
  return prefersReducedMotion ? "auto" : "smooth";
}

function scrollActiveLineIntoView(list, activeLine) {
  if (!list || !activeLine) return;
  const top = activeLine.offsetTop - list.clientHeight / 2 + activeLine.offsetHeight / 2;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  list.scrollTo({ top: Math.max(0, top), behavior: getLyricsScrollBehavior(reducedMotion) });
}

export function getLyricsPreview(segments, activeIndex) {
  if (!Array.isArray(segments) || segments.length === 0) return "";
  if (activeIndex >= 0 && activeIndex < segments.length) return segments[activeIndex].text;
  return segments[0].text;
}

function LyricsLines({ activeIndex, lineRefs, onSeek, segments, variant }) {
  const displayIndex = activeIndex >= 0 ? activeIndex : 0;

  return segments.map((segment, index) => {
    const distance = Math.min(Math.abs(index - displayIndex), 4);
    return (
      <button
        key={`${segment.start}-${index}`}
        ref={(node) => { lineRefs.current[index] = node; }}
        type="button"
        className={`${variant}-line${index === activeIndex ? ` ${variant}-line--active` : ""}`}
        data-distance={variant === "mobile-lyrics-drawer" ? distance : undefined}
        aria-current={index === activeIndex ? "true" : undefined}
        onClick={() => onSeek(segment.start)}
      >
        {segment.text}
      </button>
    );
  });
}

async function waitForCardAssets(node) {
  await document.fonts?.ready;
  await Promise.all([...node.querySelectorAll("img")].map(async (image) => {
    if (!image.complete) await new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
    await image.decode?.().catch(() => {});
  }));
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

function LyricsShareCard({ artworkFailed, cardRef, metadata, onArtworkError, selected }) {
  return (
    <div ref={cardRef} className="lyrics-share-card" aria-label="Lyrics card preview">
      {metadata.artworkUrl && !artworkFailed && (
        <img className="lyrics-share-card-backdrop" src={metadata.artworkUrl} alt="" crossOrigin="anonymous" onError={onArtworkError} />
      )}
      <div className="lyrics-share-card-wash" />
      <div className="lyrics-share-card-brand"><span>DM</span> DogMedia</div>
      <div className="lyrics-share-card-copy">
        <div className="lyrics-share-card-rule" />
        {selected.map((segment, index) => <p key={`${segment.start}-${index}`}>{segment.text}</p>)}
      </div>
      <footer className="lyrics-share-card-footer">
        {metadata.artworkUrl && !artworkFailed ? (
          <img src={metadata.artworkUrl} alt="" crossOrigin="anonymous" onError={onArtworkError} />
        ) : <span className="lyrics-share-card-art-fallback"><FontAwesomeIcon icon={faQuoteRight} /></span>}
        <div><strong>{metadata.title}</strong><span>{metadata.artists}</span></div>
      </footer>
    </div>
  );
}

function LyricsShareDialog({ activeIndex, artworkUrl, media, onClose, segments }) {
  const [anchorIndex] = useState(() => activeIndex >= 0 ? activeIndex : 0);
  const [selection, setSelection] = useState(() => createLyricsSelection(anchorIndex, segments.length));
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [artworkFailed, setArtworkFailed] = useState(false);
  const cardRef = useRef(null);
  const pickerRef = useRef(null);
  const pickerLineRefs = useRef([]);
  const metadata = useMemo(() => getLyricsShareMetadata(media, artworkUrl), [artworkUrl, media]);
  const selected = useMemo(() => getSelectedLyrics(segments, selection), [segments, selection]);
  const selectionWindow = useMemo(() => getLyricsCandidateWindow(anchorIndex, segments.length), [anchorIndex, segments.length]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => { if (event.key === "Escape" && !sharing) onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, sharing]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollActiveLineIntoView(pickerRef.current, pickerLineRefs.current[anchorIndex]);
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorIndex]);

  const share = useCallback(async () => {
    if (!cardRef.current || selected.length === 0 || sharing) return;
    setSharing(true);
    setError("");
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
      await shareLyricsBlob(blob, { filename: sanitizeLyricsFilename(metadata.title), title: metadata.title });
      onClose();
    } catch (shareError) {
      if (shareError?.name !== "AbortError") setError("Could not create the lyrics card. Try sharing again.");
    } finally {
      setSharing(false);
    }
  }, [metadata.title, onClose, selected.length, sharing]);

  return createPortal((
    <div className="lyrics-share-overlay" role="dialog" aria-modal="true" aria-labelledby="lyrics-share-title">
      <button className="lyrics-share-dismiss" type="button" aria-label="Close lyrics sharing" onClick={onClose} />
      <section className="lyrics-share-dialog">
        <header className="lyrics-share-dialog-header">
          <div><span>Share a verse</span><h2 id="lyrics-share-title">Choose up to 5 lines</h2></div>
          <button autoFocus type="button" className="lyrics-share-close" aria-label="Close lyrics sharing" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </header>
        <div className="lyrics-share-layout">
          <div ref={pickerRef} className="lyrics-share-picker" aria-label="Choose lyrics to share">
            {segments.map((segment, index) => {
              const selectedLine = selection && index >= selection.start && index <= selection.end;
              const selectable = index >= selectionWindow.start && index <= selectionWindow.end;
              return (
                <button
                  key={`${segment.start}-${index}`}
                  ref={(node) => { pickerLineRefs.current[index] = node; }}
                  type="button"
                  className={`lyrics-share-picker-line${selectedLine ? " lyrics-share-picker-line--selected" : ""}${!selectable ? " lyrics-share-picker-line--disabled" : ""}`}
                  aria-pressed={Boolean(selectedLine)}
                  disabled={!selectable}
                  onClick={() => setSelection((current) => updateLyricsSelection(current, index, segments.length))}
                >
                  {segment.text}
                </button>
              );
            })}
          </div>
          <div className="lyrics-share-preview-shell"><div className="lyrics-share-preview-frame"><LyricsShareCard artworkFailed={artworkFailed} cardRef={cardRef} metadata={metadata} onArtworkError={() => setArtworkFailed(true)} selected={selected} /></div></div>
        </div>
        {error && <p className="lyrics-share-error" role="alert">{error}</p>}
        <footer className="lyrics-share-actions">
          <span>{selected.length}/5 lines selected</span>
          <button type="button" disabled={sharing || selected.length === 0} onClick={share}><FontAwesomeIcon icon={faShareNodes} /> {sharing ? "Creating card…" : "Share image"}</button>
        </footer>
      </section>
    </div>
  ), document.body);
}

function useSynchronizedLyrics(mediaId) {
  const [lyrics, setLyrics] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setLyrics(null);

    api(`/api/media/${mediaId}/lyrics`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Lyrics unavailable");
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) setLyrics(data);
      })
      .catch(() => {});

    return () => controller.abort();
  }, [mediaId]);

  return lyrics;
}

function useLyricsShareFlow(setDrawerOpen) {
  const [shareOpen, setShareOpen] = useState(false);
  const [drawerSuspended, setDrawerSuspended] = useState(false);

  useEffect(() => {
    if (!drawerSuspended || shareOpen) return undefined;
    const timer = setTimeout(() => setShareOpen(true), 0);
    return () => clearTimeout(timer);
  }, [drawerSuspended, shareOpen]);

  const openShare = useCallback(() => setShareOpen(true), []);
  const openShareFromDrawer = useCallback(() => {
    setDrawerOpen(false);
    setDrawerSuspended(true);
  }, [setDrawerOpen]);
  const closeShare = useCallback(() => {
    setShareOpen(false);
    setDrawerSuspended(false);
  }, []);

  return { closeShare, drawerSuspended, openShare, openShareFromDrawer, shareOpen };
}

export function LyricsPanel({ artworkUrl, media, mediaId, onSeek, position }) {
  const lyrics = useSynchronizedLyrics(mediaId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [snap, setSnap] = useState(0.88);
  const { closeShare, drawerSuspended, openShare, openShareFromDrawer, shareOpen } = useLyricsShareFlow(setDrawerOpen);
  const inlineListRef = useRef(null);
  const drawerListRef = useRef(null);
  const inlineLineRefs = useRef([]);
  const drawerLineRefs = useRef([]);

  const activeIndex = useMemo(
    () => findActiveLyricsIndex(lyrics?.segments, position),
    [lyrics?.segments, position]
  );
  const shareIndex = useMemo(() => getLyricsShareIndex(lyrics?.segments, position, activeIndex), [activeIndex, lyrics?.segments, position]);

  useEffect(() => {
    const activeLine = activeIndex >= 0 ? activeIndex : 0;
    if (!shareOpen && drawerOpen && drawerListRef.current) {
      requestAnimationFrame(() => {
        scrollActiveLineIntoView(drawerListRef.current, drawerLineRefs.current[activeLine]);
      });
    }
    if (!shareOpen && inlineListRef.current) {
      scrollActiveLineIntoView(inlineListRef.current, inlineLineRefs.current[activeLine]);
    }
  }, [activeIndex, drawerOpen, shareOpen]);

  if (!lyrics?.segments?.length) return null;

  return (
    <section className="now-playing-sidebar-section now-playing-lyrics-section">
      <div className="now-playing-lyrics-heading">
        <h2>Lyrics</h2>
        <div className="lyrics-heading-actions">
          {lyrics.language && <span>{lyrics.language}</span>}
          <button type="button" className="lyrics-share-trigger" aria-label="Share lyrics" title="Share lyrics" onClick={openShare}><FontAwesomeIcon icon={faShareNodes} /></button>
        </div>
      </div>
      <div ref={inlineListRef} className="now-playing-lyrics-list now-playing-lyrics-list--inline" aria-label="Synchronized lyrics">
        <LyricsLines
          activeIndex={activeIndex}
          lineRefs={inlineLineRefs}
          onSeek={onSeek}
          segments={lyrics.segments}
          variant="now-playing-lyrics"
        />
      </div>

      {!drawerSuspended && (
        <Drawer.Root
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          snapPoints={[0.45, 0.88]}
          activeSnapPoint={snap}
          setActiveSnapPoint={setSnap}
          fadeFromIndex={0}
          autoFocus
          handleOnly
          shouldScaleBackground={false}
          setBackgroundColorOnScale={false}
        >
          <Drawer.Trigger asChild>
            <button
              type="button"
              className="lyrics-icon-button"
              aria-label="Open lyrics"
              title="Open lyrics"
            >
              <FontAwesomeIcon icon={faQuoteRight} />
            </button>
          </Drawer.Trigger>
          <Drawer.Portal>
            <Drawer.Overlay className="mobile-player-drawer-overlay" />
            <Drawer.Content className="mobile-player-drawer mobile-lyrics-drawer">
              <Drawer.Handle className="mobile-player-drawer-handle" />
              <div className="mobile-player-drawer-header">
                <div>
                  <span>Synchronized Lyrics</span>
                  <Drawer.Title className="mobile-queue-drawer-title">Lyrics</Drawer.Title>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {lyrics.language && <span className="mobile-player-drawer-chip">{lyrics.language}</span>}
                  <button type="button" className="lyrics-share-trigger" aria-label="Share lyrics" title="Share lyrics" onClick={openShareFromDrawer}><FontAwesomeIcon icon={faShareNodes} /></button>
                  <button
                    type="button"
                    className="mobile-categories-sheet-close"
                    onClick={() => setDrawerOpen(false)}
                    title="Close lyrics"
                    aria-label="Close lyrics"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <Drawer.Description className="mobile-player-drawer-description">
                Synchronized lyrics{lyrics.language ? ` in ${lyrics.language}` : ""}. Select a line to seek to it.
              </Drawer.Description>
              <div ref={drawerListRef} className="mobile-lyrics-drawer-list" aria-label="Synchronized lyrics">
                <LyricsLines
                  activeIndex={activeIndex}
                  lineRefs={drawerLineRefs}
                  onSeek={onSeek}
                  segments={lyrics.segments}
                  variant="mobile-lyrics-drawer"
                />
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
      {shareOpen && <LyricsShareDialog activeIndex={shareIndex} artworkUrl={artworkUrl} media={media} onClose={closeShare} segments={lyrics.segments} />}
    </section>
  );
}

const MOBILE_DRAWER_QUERY = "(max-width: 640px), (max-width: 900px) and (max-height: 500px) and (orientation: landscape)";

function useMobileDrawer() {
  const [mobile, setMobile] = useState(() => (
    typeof window !== "undefined" && window.matchMedia(MOBILE_DRAWER_QUERY).matches
  ));

  useEffect(() => {
    const query = window.matchMedia(MOBILE_DRAWER_QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return mobile;
}

export function FullscreenLyrics({ artworkUrl, media, mediaId, onSeek, position }) {
  const lyrics = useSynchronizedLyrics(mediaId);
  const mobile = useMobileDrawer();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [snap, setSnap] = useState(0.88);
  const { closeShare, drawerSuspended, openShare, openShareFromDrawer, shareOpen } = useLyricsShareFlow(setDrawerOpen);
  const listRef = useRef(null);
  const lineRefs = useRef([]);

  const activeIndex = useMemo(
    () => findActiveLyricsIndex(lyrics?.segments, position),
    [lyrics?.segments, position]
  );
  const shareIndex = useMemo(() => getLyricsShareIndex(lyrics?.segments, position, activeIndex), [activeIndex, lyrics?.segments, position]);
  const displayActiveIndex = activeIndex >= 0 ? activeIndex : 0;

  useEffect(() => {
    if (!shareOpen && listRef.current && (!mobile || drawerOpen)) {
      requestAnimationFrame(() => {
        const list = listRef.current;
        const activeLine = lineRefs.current[displayActiveIndex];
        scrollActiveLineIntoView(list, activeLine);
      });
    }
  }, [displayActiveIndex, drawerOpen, mobile, shareOpen]);

  if (mobile) {
    if (!lyrics?.segments?.length) return null;
    return (
      <>
        {!drawerSuspended && <Drawer.Root
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          snapPoints={[0.45, 0.88]}
          activeSnapPoint={snap}
          setActiveSnapPoint={setSnap}
          fadeFromIndex={0}
          autoFocus
          handleOnly
          shouldScaleBackground={false}
          setBackgroundColorOnScale={false}
        >
          <Drawer.Trigger asChild>
            <button
              type="button"
              className="lyrics-icon-button"
              aria-label="Open lyrics"
              title="Open lyrics"
            >
              <FontAwesomeIcon icon={faQuoteRight} />
            </button>
          </Drawer.Trigger>
          <Drawer.Portal>
            <Drawer.Overlay className="mobile-player-drawer-overlay" />
            <Drawer.Content className="mobile-player-drawer mobile-lyrics-drawer">
              <Drawer.Handle className="mobile-player-drawer-handle" />
              <div className="mobile-player-drawer-header">
                <div>
                  <span>Synchronized Lyrics</span>
                  <Drawer.Title className="mobile-queue-drawer-title">Lyrics</Drawer.Title>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {lyrics.language && <span className="mobile-player-drawer-chip">{lyrics.language}</span>}
                  <button type="button" className="lyrics-share-trigger" aria-label="Share lyrics" title="Share lyrics" onClick={openShareFromDrawer}><FontAwesomeIcon icon={faShareNodes} /></button>
                  <button
                    type="button"
                    className="mobile-categories-sheet-close"
                    onClick={() => setDrawerOpen(false)}
                    title="Close lyrics"
                    aria-label="Close lyrics"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <Drawer.Description className="mobile-player-drawer-description">
                Synchronized lyrics{lyrics.language ? ` in ${lyrics.language}` : ""}. Select a line to seek to it.
              </Drawer.Description>
              <div ref={listRef} className="mobile-lyrics-drawer-list" aria-label="Synchronized lyrics">
                <LyricsLines
                  activeIndex={activeIndex}
                  lineRefs={lineRefs}
                  onSeek={onSeek}
                  segments={lyrics.segments}
                  variant="mobile-lyrics-drawer"
                />
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>}
        {shareOpen && <LyricsShareDialog activeIndex={shareIndex} artworkUrl={artworkUrl} media={media} onClose={closeShare} segments={lyrics.segments} />}
      </>
    );
  }

  if (!lyrics?.segments?.length) {
    return (
      <section className="fullscreen-lyrics fullscreen-lyrics--empty" aria-label="Synchronized lyrics">
        <p>Lyrics will appear here when they are available for this track.</p>
      </section>
    );
  }

  return (
    <section className="fullscreen-lyrics" aria-label="Synchronized lyrics">
      <button type="button" className="fullscreen-lyrics-share" aria-label="Share lyrics" title="Share lyrics" onClick={openShare}><FontAwesomeIcon icon={faShareNodes} /> Share lyrics</button>
      <div ref={listRef} className="fullscreen-lyrics-list">
        {lyrics.segments.map((segment, index) => {
          const distance = Math.max(Math.min(index - displayActiveIndex, 4), -4);
          const active = index === activeIndex;
          return (
            <button
              key={`${segment.start}-${index}`}
              ref={(node) => { lineRefs.current[index] = node; }}
              type="button"
              className={active ? "fullscreen-lyrics-line fullscreen-lyrics-line--active" : "fullscreen-lyrics-line"}
              style={{ "--lyric-distance": distance }}
              aria-current={active ? "true" : undefined}
              onClick={() => onSeek(segment.start)}
            >
              {segment.text}
            </button>
          );
        })}
      </div>
      {shareOpen && <LyricsShareDialog activeIndex={shareIndex} artworkUrl={artworkUrl} media={media} onClose={closeShare} segments={lyrics.segments} />}
    </section>
  );
}
