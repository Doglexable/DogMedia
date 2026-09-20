import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilm } from "@fortawesome/free-solid-svg-icons/faFilm";
import { faDownload } from "@fortawesome/free-solid-svg-icons/faDownload";
import { faRotateRight } from "@fortawesome/free-solid-svg-icons/faRotateRight";
import { faShieldHalved } from "@fortawesome/free-solid-svg-icons/faShieldHalved";
import { faMusic } from "@fortawesome/free-solid-svg-icons/faMusic";
import { faLock } from "@fortawesome/free-solid-svg-icons/faLock";
import { api, apiUrl } from "../api";
import Squares from "../components/Squares";
import SpotlightCard from "../components/SpotlightCard";
import ShinyText from "../components/ShinyText";
import SplitText from "../components/SplitText";
import Magnet from "../components/Magnet";
import "./SharedMusic.css";

const PROCESSING = new Set(["queued", "processing"]);

export function SharedMusicHeader({ singleTrack = true }) {
  return (
    <header className="shared-music-header">
      <Magnet magnetStrength={0.15}>
        <a className="shared-music-brand" href="/" aria-label="Dogmedia Home">
          <img
            src="/web-app-manifest-192x192.png"
            alt=""
            className="shared-music-brand-icon"
            width="26"
            height="26"
            aria-hidden="true"
          />
          <span className="shared-music-brand-title">Dogmedia</span>
          <span className="shared-music-brand-tag">
            <ShinyText text={singleTrack ? "Music Clip" : "Favorite Reel"} speed={3} />
          </span>
        </a>
      </Magnet>
      <div className="shared-music-privacy-badge">
        <FontAwesomeIcon icon={faShieldHalved} />
        <span>Private Stream</span>
      </div>
    </header>
  );
}

export function SharedMusicLoading() {
  return (
    <SpotlightCard
      className="shared-music-state-card"
      spotlightColor="rgba(225, 29, 72, 0.22)"
      aria-live="polite"
    >
      <div className="shared-music-loading-equalizer" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <h1>Opening the favorite reel…</h1>
      <p>
        <ShinyText text="Loading chunk stream and metadata" speed={2.5} />
      </p>
    </SpotlightCard>
  );
}

export function SharedMusicError({ error, onRetry }) {
  return (
    <SpotlightCard
      className="shared-music-state-card shared-music-state-card--error"
      spotlightColor="rgba(239, 68, 68, 0.2)"
    >
      <FontAwesomeIcon icon={faFilm} className="shared-music-state-icon" />
      <h1>This reel is not available</h1>
      <p>{error}. Ask the sender for a new link.</p>
      <Magnet magnetStrength={0.25}>
        <button type="button" onClick={onRetry} className="shared-music-retry-btn">
          <FontAwesomeIcon icon={faRotateRight} /> Try again
        </button>
      </Magnet>
    </SpotlightCard>
  );
}

export function SharedReelProcessing({ status, progress = 0 }) {
  return (
    <SpotlightCard
      className="shared-reel-processing-card"
      spotlightColor="rgba(225, 29, 72, 0.25)"
      aria-live="polite"
    >
      <div className="shared-reel-processing-grid">
        <div className="shared-reel-countdown-badge">
          <span>RENDERING</span>
          <strong>{progress || 0}</strong>
          <small>%</small>
        </div>
        <div className="shared-reel-processing-info">
          <div className="shared-reel-kicker-pill">
            <FontAwesomeIcon icon={faFilm} />
            <ShinyText text="THE SERVER IS CUTTING THE REEL" speed={3} />
          </div>
          <h1>
            {status === "queued"
              ? "Waiting for the render worker."
              : "Turning each favorite into a 10-second scene."}
          </h1>
          <div className="shared-reel-progress-track">
            <span
              className="shared-reel-progress-fill"
              style={{ width: `${progress || 0}%` }}
            />
          </div>
          <div className="shared-reel-processing-auto">
            <span className="shared-reel-pulsing-dot" aria-hidden="true" />
            <small>This page checks automatically. No refresh needed.</small>
          </div>
        </div>
      </div>
    </SpotlightCard>
  );
}

export function SharedReelPlayer({ data, singleTrack }) {
  return (
    <section className="shared-reel-player" aria-label="Shared favorite music reel">
      {/* Media showcase card */}
      <SpotlightCard
        className="shared-reel-card shared-reel-media-card"
        spotlightColor="rgba(225, 29, 72, 0.2)"
      >
        <div className="shared-reel-video-shell">
          <div className="shared-reel-media-glow" aria-hidden="true" />
          <video
            src={apiUrl(data.streamUrl)}
            controls
            playsInline
            preload="metadata"
            controlsList="noplaybackrate"
            disablePictureInPicture
          />
          <div className="shared-reel-spec-tag">
            <span className="shared-reel-spec-badge">
              <FontAwesomeIcon icon={faFilm} />
              <span>4:3 · {data.tracks.length * 10} SEC</span>
            </span>
            <span className="shared-reel-audio-hint">Direct Audio Chunks</span>
          </div>
        </div>
      </SpotlightCard>

      {/* Information & Tracks card */}
      <SpotlightCard
        className="shared-reel-card shared-reel-info-card"
        spotlightColor="rgba(169, 156, 214, 0.16)"
      >
        <div className="shared-reel-copy">
          <div className="shared-reel-kicker-pill">
            <FontAwesomeIcon icon={faMusic} />
            <ShinyText
              text={singleTrack ? "SHARED MUSIC CLIP" : "ONE LISTENER’S ROTATION"}
              speed={3}
            />
          </div>

          <h1 className="shared-reel-heading">
            <SplitText
              text={
                singleTrack
                  ? "Ten seconds from this track."
                  : "Ten seconds from the favorites."
              }
              delay={22}
            />
          </h1>

          <ol className="shared-reel-tracklist">
            {data.tracks.map((track) => (
              <li
                key={`${track.position}-${track.title}`}
                className="shared-reel-track-row"
              >
                <span className="shared-reel-track-idx">
                  {String(track.position).padStart(2, "0")}
                </span>
                <div className="shared-reel-track-meta">
                  <strong className="shared-reel-track-name" title={track.title}>
                    {track.title}
                  </strong>
                  <small className="shared-reel-track-by">
                    {track.artists || "Unknown artist"}
                  </small>
                </div>
                <span className="shared-reel-track-time">10s</span>
              </li>
            ))}
          </ol>

          <div className="shared-reel-actions">
            <Magnet magnetStrength={0.25} className="shared-reel-download-magnet">
              <a
                className="shared-reel-download-btn shared-reel-download"
                href={apiUrl(data.downloadUrl)}
                download
              >
                <FontAwesomeIcon icon={faDownload} />
                <span>Download MP4</span>
              </a>
            </Magnet>

            <div className="shared-reel-footer-meta">
              <FontAwesomeIcon icon={faLock} />
              <span>
                Private link · expires{" "}
                {new Date(data.shareExpiresAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      </SpotlightCard>
    </section>
  );
}

export default function SharedMusic() {
  const [state, setState] = useState({ loading: true, data: null, error: "" });

  const loadShare = useCallback(() => {
    const token = window.location.hash.slice(1);
    api("/api/public/music/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "This music reel is not available");
        setState({ loading: false, data, error: "" });
      })
      .catch((error) => setState({ loading: false, data: null, error: error.message }));
  }, []);

  useEffect(loadShare, [loadShare]);

  useEffect(() => {
    if (!PROCESSING.has(state.data?.status)) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden") loadShare();
    };
    const interval = window.setInterval(refreshWhenVisible, 2500);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadShare, state.data?.status]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="robots"]') || document.head.appendChild(document.createElement("meta"));
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "noindex, nofollow, noarchive");
    return () => meta.setAttribute("content", "noindex, nofollow");
  }, []);

  const data = state.data;
  const singleTrack = data?.tracks?.length === 1;

  return (
    <main className="shared-music-page shared-reel-page">
      {/* React Bits Squares interactive canvas background */}
      <div className="shared-music-bg-canvas">
        <Squares
          direction="diagonal"
          speed={0.35}
          squareSize={46}
          borderColor="rgba(255, 255, 255, 0.04)"
          hoverFillColor="rgba(225, 29, 72, 0.16)"
        />
      </div>
      <div className="shared-music-veil" aria-hidden="true" />

      <SharedMusicHeader singleTrack={singleTrack} />

      <div className="shared-music-content">
        {state.loading ? (
          <SharedMusicLoading />
        ) : state.error ? (
          <SharedMusicError error={state.error} onRetry={loadShare} />
        ) : PROCESSING.has(data.status) ? (
          <SharedReelProcessing status={data.status} progress={data.progress} />
        ) : (
          <SharedReelPlayer data={data} singleTrack={singleTrack} />
        )}
      </div>
    </main>
  );
}
