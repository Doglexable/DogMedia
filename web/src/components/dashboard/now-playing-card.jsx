import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons/faCheck";
import { faCopy } from "@fortawesome/free-solid-svg-icons/faCopy";
import { faFilm } from "@fortawesome/free-solid-svg-icons/faFilm";
import { faMusic } from "@fortawesome/free-solid-svg-icons/faMusic";
import { mediaThumbnailUrl } from "../../api";
import "./now-playing.css";

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
  const [imgFailed, setImgFailed] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const handleCopyIp = (e) => {
    e.stopPropagation();
    if (!session?.ip) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(session.ip).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const stateLabels = playbackStateLabels(session);
  const displayPosition = playbackDisplayPosition(session, renderNow);
  const progressPercent = playbackProgressPercent(displayPosition, session?.duration);
  const title = session?.title || `Media #${session?.mediaId}`;
  const thumbUrl = session?.mediaId ? mediaThumbnailUrl(session.mediaId) : null;

  return (
    <article
      key={session ? `${session.ip}-${session.mediaId}-${index}` : index}
      className="magic-bento-now-playing now-playing-session-card"
      aria-label={`Now playing: ${title}`}
    >
      {/* Top Header: IP Pill + Play/Pause Status */}
      <div className="magic-bento-now-playing__top now-playing-session-card__header">
        <button
          type="button"
          className="magic-bento-now-playing__ip now-playing-session-card__ip-btn"
          onClick={handleCopyIp}
          title={copied ? "IP copied to clipboard!" : `Click to copy IP (${session?.ip})`}
          aria-label={`Copy IP address ${session?.ip}`}
        >
          <span>{session?.ip}</span>
          <FontAwesomeIcon
            icon={copied ? faCheck : faCopy}
            className="now-playing-session-card__copy-icon"
            style={copied ? { color: "#22c55e" } : undefined}
          />
        </button>

        <span
          className={`magic-bento-now-playing__status magic-bento-now-playing__status--${session?.action === "play" ? "play" : "pause"} now-playing-session-card__status now-playing-session-card__status--${session?.action === "play" ? "play" : "pause"}`}
        >
          {session?.action === "play" ? (
            <span className="now-playing-eq-bars" aria-hidden="true">
              <span className="now-playing-eq-bar bar-1" />
              <span className="now-playing-eq-bar bar-2" />
              <span className="now-playing-eq-bar bar-3" />
            </span>
          ) : (
            <span className="magic-bento-now-playing__dot now-playing-session-card__dot" />
          )}
          {session?.action}
        </span>
      </div>

      {/* Main Content Body: Artwork Thumbnail + Info + Action */}
      <div className="magic-bento-now-playing__body now-playing-session-card__body">
        <div className="now-playing-session-card__thumb-wrap" aria-hidden="true">
          {thumbUrl && !imgFailed ? (
            <img
              src={thumbUrl}
              alt=""
              className="now-playing-session-card__thumb"
              loading="lazy"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="now-playing-session-card__thumb-fallback">
              <FontAwesomeIcon icon={session?.mime_type?.startsWith("video/") ? faFilm : faMusic} />
            </div>
          )}
        </div>

        <div className="now-playing-session-card__meta">
          <h3 aria-label={title} className="magic-bento-now-playing__title now-playing-card-title now-playing-session-card__title">
            {title}
          </h3>
          <div className="now-playing-session-card__sub-row">
            <p className="magic-bento-now-playing__sub now-playing-session-card__sub">
              Media #{session?.mediaId}
            </p>
          </div>
        </div>
      </div>

      {/* Progress Bar & Timing */}
      <div className="magic-bento-now-playing__progress now-playing-session-card__progress">
        <div className="magic-bento-now-playing__meta now-playing-session-card__times">
          <span>{fmtDur(displayPosition)}</span>
          <span>{fmtDur(session?.duration)}</span>
        </div>
        <div className="magic-bento-now-playing__track now-playing-session-card__track" aria-hidden="true">
          <div
            className="magic-bento-now-playing__fill now-playing-session-card__fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Mode Badges (loop queue, shuffle, etc.) */}
      {stateLabels.length > 0 && (
        <div className="magic-bento-now-playing__badges now-playing-session-card__badges">
          {stateLabels.map((label) => (
            <span key={label} className="magic-bento-now-playing__badge now-playing-session-card__badge">
              {label}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export default NowPlayingCard;
