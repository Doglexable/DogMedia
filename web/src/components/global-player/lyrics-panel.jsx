import { useEffect, useMemo, useRef, useState } from "react";
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
  const inlineListRef = useRef(null);
  const drawerListRef = useRef(null);
  const inlineLineRefs = useRef([]);
  const drawerLineRefs = useRef([]);

  const activeIndex = useMemo(
    () => findActiveLyricsIndex(lyrics?.segments, position),
    [lyrics?.segments, position]
  );

  useEffect(() => {
    scrollActiveLineIntoView(inlineListRef.current, inlineLineRefs.current[activeIndex]);
    if (drawerOpen) {
      scrollActiveLineIntoView(drawerListRef.current, drawerLineRefs.current[activeIndex]);
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
        autoFocus
        handleOnly
        shouldScaleBackground={false}
        setBackgroundColorOnScale={false}
      >
        <Drawer.Trigger asChild>
          <button type="button" className="now-playing-lyrics-mobile-trigger">
            <span className="now-playing-lyrics-mobile-kicker">
              <span aria-hidden="true" />
              Live lyrics
            </span>
            <strong>{getLyricsPreview(lyrics.segments, activeIndex)}</strong>
            <small>Open full lyrics</small>
          </button>
        </Drawer.Trigger>
        <Drawer.Portal>
          <Drawer.Overlay className="mobile-player-drawer-overlay" />
          <Drawer.Content className="mobile-player-drawer mobile-lyrics-drawer">
            <Drawer.Handle className="mobile-player-drawer-handle" />
            <Drawer.Title className="mobile-player-drawer-description">Lyrics</Drawer.Title>
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

export function FullscreenLyrics({ mediaId, onSeek, position }) {
  const lyrics = useSynchronizedLyrics(mediaId);
  const listRef = useRef(null);
  const lineRefs = useRef([]);

  const activeIndex = useMemo(
    () => findActiveLyricsIndex(lyrics?.segments, position),
    [lyrics?.segments, position]
  );
  const displayActiveIndex = activeIndex >= 0 ? activeIndex : 0;

  useEffect(() => {
    const list = listRef.current;
    const activeLine = lineRefs.current[displayActiveIndex];
    scrollActiveLineIntoView(list, activeLine);
  }, [displayActiveIndex]);

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
