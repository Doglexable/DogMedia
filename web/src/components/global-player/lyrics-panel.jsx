import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faQuoteRight } from "@fortawesome/free-solid-svg-icons";
import { Drawer } from "vaul";
import { api } from "../../api";

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

export function LyricsPanel({ mediaId, onSeek, position }) {
  const lyrics = useSynchronizedLyrics(mediaId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [snap, setSnap] = useState(0.88);
  const inlineListRef = useRef(null);
  const drawerListRef = useRef(null);
  const inlineLineRefs = useRef([]);
  const drawerLineRefs = useRef([]);

  const activeIndex = useMemo(
    () => findActiveLyricsIndex(lyrics?.segments, position),
    [lyrics?.segments, position]
  );

  useEffect(() => {
    const activeLine = activeIndex >= 0 ? activeIndex : 0;
    if (drawerOpen && drawerListRef.current) {
      requestAnimationFrame(() => {
        scrollActiveLineIntoView(drawerListRef.current, drawerLineRefs.current[activeLine]);
      });
    }
    if (inlineListRef.current) {
      scrollActiveLineIntoView(inlineListRef.current, inlineLineRefs.current[activeLine]);
    }
  }, [activeIndex, drawerOpen]);

  if (!lyrics?.segments?.length) return null;

  return (
    <section className="now-playing-sidebar-section now-playing-lyrics-section">
      <div className="now-playing-lyrics-heading">
        <h2>Lyrics</h2>
        {lyrics.language && <span>{lyrics.language}</span>}
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
    </section>
  );
}

const MOBILE_DRAWER_QUERY = "(max-width: 640px)";

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

export function FullscreenLyrics({ mediaId, onSeek, position }) {
  const lyrics = useSynchronizedLyrics(mediaId);
  const mobile = useMobileDrawer();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [snap, setSnap] = useState(0.88);
  const listRef = useRef(null);
  const lineRefs = useRef([]);

  const activeIndex = useMemo(
    () => findActiveLyricsIndex(lyrics?.segments, position),
    [lyrics?.segments, position]
  );
  const displayActiveIndex = activeIndex >= 0 ? activeIndex : 0;

  useEffect(() => {
    if (listRef.current && (!mobile || drawerOpen)) {
      requestAnimationFrame(() => {
        const list = listRef.current;
        const activeLine = lineRefs.current[displayActiveIndex];
        scrollActiveLineIntoView(list, activeLine);
      });
    }
  }, [displayActiveIndex, drawerOpen, mobile]);

  if (mobile) {
    if (!lyrics?.segments?.length) return null;
    return (
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
      </Drawer.Root>
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
    </section>
  );
}
