import { useEffect, useMemo, useRef, useState } from "react";
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
  const listRef = useRef(null);
  const lineRefs = useRef([]);

  const activeIndex = useMemo(
    () => findActiveLyricsIndex(lyrics?.segments, position),
    [lyrics?.segments, position]
  );

  useEffect(() => {
    const list = listRef.current;
    const activeLine = lineRefs.current[activeIndex];
    scrollActiveLineIntoView(list, activeLine);
  }, [activeIndex]);

  if (!lyrics?.segments?.length) return null;

  return (
    <section className="now-playing-sidebar-section now-playing-lyrics-section">
      <div className="now-playing-lyrics-heading">
        <h2>Lyrics</h2>
        {lyrics.language && <span>{lyrics.language}</span>}
      </div>
      <div ref={listRef} className="now-playing-lyrics-list" aria-label="Synchronized lyrics">
        {lyrics.segments.map((segment, index) => (
          <button
            key={`${segment.start}-${index}`}
            ref={(node) => { lineRefs.current[index] = node; }}
            type="button"
            className={index === activeIndex ? "now-playing-lyrics-line now-playing-lyrics-line--active" : "now-playing-lyrics-line"}
            aria-current={index === activeIndex ? "true" : undefined}
            onClick={() => onSeek(segment.start)}
          >
            {segment.text}
          </button>
        ))}
      </div>
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
