import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";

export function findActiveLyricsIndex(segments, position) {
  if (!Array.isArray(segments) || !Number.isFinite(position)) return -1;
  return segments.findIndex((segment) => position >= segment.start && position <= segment.end);
}

export function LyricsPanel({ mediaId, onSeek, position }) {
  const [lyrics, setLyrics] = useState(null);
  const listRef = useRef(null);
  const lineRefs = useRef([]);

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

  const activeIndex = useMemo(
    () => findActiveLyricsIndex(lyrics?.segments, position),
    [lyrics?.segments, position]
  );

  useEffect(() => {
    const list = listRef.current;
    const activeLine = lineRefs.current[activeIndex];
    if (!list || !activeLine) return;

    const top = activeLine.offsetTop - list.clientHeight / 2 + activeLine.offsetHeight / 2;
    list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
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

