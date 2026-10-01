import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faQuoteRight } from "@fortawesome/free-solid-svg-icons/faQuoteRight";
import { faShareNodes } from "@fortawesome/free-solid-svg-icons/faShareNodes";
import { Drawer } from "vaul";
import { fetchLyrics, getCachedLyrics } from "./lyrics-cache";
import { AudioShareDialog } from "./audio-share-dialog";
import { LyricsShareCard } from "./lyrics-card-preview";

export { LyricsShareCard };

export function findActiveLyricsIndex(segments, position) {
  if (!Array.isArray(segments) || !Number.isFinite(position)) return -1;
  return segments.findIndex((segment) => position >= segment.start && position <= segment.end);
}

export function findLyricsFocusIndex(segments, position) {
  if (!Array.isArray(segments) || segments.length === 0) return -1;

  const activeIndex = findActiveLyricsIndex(segments, position);
  if (activeIndex >= 0) return activeIndex;
  if (!Number.isFinite(position)) return 0;

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (position >= segments[index].start) return index;
  }
  return 0;
}

export const MIN_INSTRUMENTAL_GAP_SECONDS = 3;

export function buildLyricsDisplaySegments(segments, minimumGap = MIN_INSTRUMENTAL_GAP_SECONDS) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const displaySegments = [];
  const appendInstrumental = (start, end) => {
    if (end - start < minimumGap) return;
    displaySegments.push({
      start,
      end: Number((end - 0.001).toFixed(3)),
      text: "Instrumental",
      instrumental: true,
    });
  };

  appendInstrumental(0, Number(segments[0].start));
  segments.forEach((segment, lyricIndex) => {
    displaySegments.push({ ...segment, instrumental: false, lyricIndex });
    const next = segments[lyricIndex + 1];
    if (next) appendInstrumental(Number(segment.end), Number(next.start));
  });

  return displaySegments;
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

function LyricsLines({ activeIndex, focusIndex, lineRefs, onSeek, segments, variant }) {
  return segments.map((segment, index) => {
    const distance = Math.min(Math.abs(index - focusIndex), 4);
    return (
      <button
        key={`${segment.start}-${index}`}
        ref={(node) => { lineRefs.current[index] = node; }}
        type="button"
        className={`${variant}-line${index === activeIndex ? ` ${variant}-line--active` : ""}${segment.instrumental ? ` ${variant}-line--instrumental` : ""}`}
        data-distance={variant === "mobile-lyrics-drawer" ? distance : undefined}
        aria-current={index === activeIndex ? "true" : undefined}
        onClick={() => onSeek(segment.start)}
      >
        {segment.instrumental ? `♪ ${segment.text}` : segment.text}
      </button>
    );
  });
}

export function LyricsShareDialog({ activeIndex, artworkUrl, media, onClose, segments }) {
  const initialPosition = Number(segments?.[activeIndex]?.start || 0);
  return (
    <AudioShareDialog
      artworkUrl={artworkUrl}
      currentMedia={media}
      duration={media?.duration}
      initialPosition={initialPosition}
      initialTab="lyrics"
      lyrics={segments ? { segments } : null}
      onClose={onClose}
    />
  );
}

function useSynchronizedLyrics(mediaId) {
  const normalizedId = Number(mediaId);
  const validId = Number.isFinite(normalizedId) && normalizedId > 0 ? normalizedId : null;
  const [lyrics, setLyrics] = useState(() => (validId ? getCachedLyrics(validId) : null));

  useEffect(() => {
    if (!validId) {
      setLyrics(null);
      return;
    }

    const cached = getCachedLyrics(validId);
    if (cached !== null) {
      setLyrics(cached);
      return;
    }

    let active = true;
    const controller = new AbortController();

    fetchLyrics(validId, { signal: controller.signal })
      .then((data) => {
        if (active) setLyrics(data);
      })
      .catch(() => {
        if (active) setLyrics(null);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [validId]);

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

export function LyricsPanel({ artworkUrl, media, mediaId, onSeek, position, lyrics: propLyrics }) {
  const resolvedMediaId = Number(media?.id ?? media?.mediaId ?? mediaId);
  const fallbackLyrics = useSynchronizedLyrics(propLyrics !== undefined ? null : resolvedMediaId);
  const rawLyrics = propLyrics !== undefined ? propLyrics : fallbackLyrics;
  const lyrics = (rawLyrics && (!rawLyrics.mediaId || Number(rawLyrics.mediaId) === resolvedMediaId))
    ? rawLyrics
    : null;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [snap, setSnap] = useState(0.88);
  const { closeShare, drawerSuspended, openShare, openShareFromDrawer, shareOpen } = useLyricsShareFlow(setDrawerOpen);
  const inlineListRef = useRef(null);
  const drawerListRef = useRef(null);
  const inlineLineRefs = useRef([]);
  const drawerLineRefs = useRef([]);

  const displaySegments = useMemo(() => buildLyricsDisplaySegments(lyrics?.segments), [lyrics?.segments]);
  const activeIndex = useMemo(
    () => findActiveLyricsIndex(displaySegments, position),
    [displaySegments, position]
  );
  const focusIndex = useMemo(
    () => findLyricsFocusIndex(displaySegments, position),
    [displaySegments, position]
  );

  useEffect(() => {
    if (!shareOpen && drawerOpen && drawerListRef.current) {
      requestAnimationFrame(() => {
        scrollActiveLineIntoView(drawerListRef.current, drawerLineRefs.current[focusIndex]);
      });
    }
    if (!shareOpen && inlineListRef.current) {
      scrollActiveLineIntoView(inlineListRef.current, inlineLineRefs.current[focusIndex]);
    }
  }, [drawerOpen, focusIndex, shareOpen]);

  if (!lyrics?.segments?.length) return null;

  return (
    <section className="now-playing-lyrics-section">
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
          focusIndex={focusIndex}
          lineRefs={inlineLineRefs}
          onSeek={onSeek}
          segments={displaySegments}
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
                  focusIndex={focusIndex}
                  lineRefs={drawerLineRefs}
                  onSeek={onSeek}
                  segments={displaySegments}
                  variant="mobile-lyrics-drawer"
                />
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
      {shareOpen && (
        <AudioShareDialog
          artworkUrl={artworkUrl}
          currentMedia={media}
          duration={media?.duration}
          initialPosition={position}
          initialTab="lyrics"
          lyrics={lyrics}
          lyricsLoading={false}
          onClose={closeShare}
        />
      )}
    </section>
  );
}



export function FullscreenLyrics({ artworkUrl: _artworkUrl, media, mediaId, onSeek, position, lyrics: propLyrics, lyricsLoading = false }) {
  const resolvedMediaId = Number(media?.id ?? media?.mediaId ?? mediaId);
  const fallbackLyrics = useSynchronizedLyrics(propLyrics !== undefined ? null : resolvedMediaId);
  const rawLyrics = propLyrics !== undefined ? propLyrics : fallbackLyrics;
  const lyrics = (rawLyrics && (!rawLyrics.mediaId || Number(rawLyrics.mediaId) === resolvedMediaId))
    ? rawLyrics
    : null;
  const listRef = useRef(null);
  const lineRefs = useRef([]);

  const displaySegments = useMemo(() => buildLyricsDisplaySegments(lyrics?.segments), [lyrics?.segments]);
  const activeIndex = useMemo(
    () => findActiveLyricsIndex(displaySegments, position),
    [displaySegments, position]
  );
  const focusIndex = useMemo(
    () => findLyricsFocusIndex(displaySegments, position),
    [displaySegments, position]
  );

  useEffect(() => {
    if (listRef.current) {
      requestAnimationFrame(() => {
        const list = listRef.current;
        const activeLine = lineRefs.current[focusIndex];
        scrollActiveLineIntoView(list, activeLine);
      });
    }
  }, [focusIndex]);

  if (!lyrics?.segments?.length) {
    return (
      <section className="fullscreen-lyrics fullscreen-lyrics--empty" aria-label="Synchronized lyrics">
        {lyricsLoading ? (
          <p>Loading timed lyrics…</p>
        ) : (
          <p>Lyrics will appear here when they are available for this track.</p>
        )}
      </section>
    );
  }

  return (
    <section className="fullscreen-lyrics" aria-label="Synchronized lyrics">
      <div ref={listRef} className="fullscreen-lyrics-list">
        {displaySegments.map((segment, index) => {
          const distance = Math.max(Math.min(index - focusIndex, 4), -4);
          const active = index === activeIndex;
          return (
            <button
              key={`${segment.start}-${index}`}
              ref={(node) => { lineRefs.current[index] = node; }}
              type="button"
              className={`fullscreen-lyrics-line${active ? " fullscreen-lyrics-line--active" : ""}${segment.instrumental ? " fullscreen-lyrics-line--instrumental" : ""}`}
              style={{ "--lyric-distance": distance }}
              aria-current={active ? "true" : undefined}
              onClick={() => onSeek(segment.start)}
            >
              {segment.instrumental ? `♪ ${segment.text}` : segment.text}
            </button>
          );
        })}
      </div>
    </section>
  );
}
