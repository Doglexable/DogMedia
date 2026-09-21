import { useEffect, useState } from "react";

export const NOW_PLAYING_TICK_MS = 1000;

export function fmtDur(s) {
  const seconds = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function playbackDisplayPosition(session, nowMs) {
  const position = Math.max(0, Math.floor(Number(session?.position) || 0));
  const duration = Math.max(0, Math.floor(Number(session?.duration) || 0));

  if (session?.action !== "play" || duration <= 0) return position;

  const timestampMs = Date.parse(session?.timestamp);
  if (!Number.isFinite(timestampMs)) return Math.min(position, duration);

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  return Math.min(position + elapsedSeconds, duration);
}

export function playbackProgressPercent(position, duration) {
  const current = Number(position) || 0;
  const total = Number(duration) || 0;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

export function playbackStateLabels(session) {
  const labels = [];
  if (session?.loopMode === "queue") labels.push("loop queue");
  if (session?.loopMode === "media") labels.push("loop media");
  if (session?.shuffleEnabled) labels.push("shuffle");
  return labels;
}

export function NowPlayingCard({ session, index }) {
  const [renderNow, setRenderNow] = useState(() => Date.now());

  const isPlaying = session?.action === "play";

  useEffect(() => {
    if (!isPlaying) return undefined;

    const updateNow = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setRenderNow(Date.now());
    };

    const tick = setInterval(updateNow, NOW_PLAYING_TICK_MS);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", updateNow);
    }

    return () => {
      clearInterval(tick);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", updateNow);
      }
    };
  }, [isPlaying, session?.timestamp]);

  const stateLabels = playbackStateLabels(session);
  const displayPosition = playbackDisplayPosition(session, renderNow);
  const progressPercent = playbackProgressPercent(displayPosition, session?.duration);
  const title = session?.title || `Media #${session?.mediaId}`;

  return (
    <article
      key={session ? `${session.ip}-${session.mediaId}-${index}` : index}
      className="magic-bento-now-playing"
      aria-label={`Now playing: ${title}`}
    >
      <div className="magic-bento-now-playing__top">
        <span className="magic-bento-now-playing__ip">{session?.ip}</span>
        <span
          className={`magic-bento-now-playing__status magic-bento-now-playing__status--${session?.action === "play" ? "play" : "pause"}`}
        >
          <span className="magic-bento-now-playing__dot" />
          {session?.action}
        </span>
      </div>

      <div className="magic-bento-now-playing__body">
        <h3 aria-label={title} className="magic-bento-now-playing__title now-playing-card-title">
          {title}
        </h3>
        <p className="magic-bento-now-playing__sub">Media #{session?.mediaId}</p>
      </div>

      <div className="magic-bento-now-playing__progress">
        <div className="magic-bento-now-playing__meta">
          <span>{fmtDur(displayPosition)}</span>
          <span>{fmtDur(session?.duration)}</span>
        </div>
        <div className="magic-bento-now-playing__track" aria-hidden="true">
          <div
            className="magic-bento-now-playing__fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {stateLabels.length > 0 && (
        <div className="magic-bento-now-playing__badges">
          {stateLabels.map((label) => (
            <span key={label} className="magic-bento-now-playing__badge">
              {label}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export default NowPlayingCard;
