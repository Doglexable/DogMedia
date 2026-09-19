import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilm } from "@fortawesome/free-solid-svg-icons/faFilm";
import { faDownload } from "@fortawesome/free-solid-svg-icons/faDownload";
import { faRotateRight } from "@fortawesome/free-solid-svg-icons/faRotateRight";
import { api, apiUrl } from "../api";

const PROCESSING = new Set(["queued", "processing"]);

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
      <div className="shared-music-veil" aria-hidden="true" />
      <a className="shared-music-brand" href="/">DOGMEDIA <span>{singleTrack ? "MUSIC CLIP" : "FAVORITE REEL"}</span></a>

      {state.loading ? (
        <section className="shared-music-state" aria-live="polite"><span className="shared-music-spinner" /><p>Opening the favorite reel…</p></section>
      ) : state.error ? (
        <section className="shared-music-state shared-music-state--error">
          <FontAwesomeIcon icon={faFilm} />
          <h1>This reel is not available</h1>
          <p>{state.error}. Ask the sender for a new link.</p>
          <button type="button" onClick={loadShare}><FontAwesomeIcon icon={faRotateRight} /> Try again</button>
        </section>
      ) : PROCESSING.has(data.status) ? (
        <section className="shared-reel-wait" aria-live="polite">
          <div className="shared-reel-countdown"><span>RENDERING</span><strong>{data.progress || 0}</strong><small>%</small></div>
          <div><p>THE SERVER IS CUTTING THE REEL</p><h1>{data.status === "queued" ? "Waiting for the render worker." : "Turning each favorite into a 10-second scene."}</h1><div className="shared-reel-progress"><span style={{ width: `${data.progress || 0}%` }} /></div><small>This page checks automatically. No refresh needed.</small></div>
        </section>
      ) : (
        <section className="shared-reel-player" aria-label="Shared favorite music reel">
          <div className="shared-reel-video-shell">
            <video src={apiUrl(data.streamUrl)} controls playsInline preload="metadata" controlsList="noplaybackrate" disablePictureInPicture />
            <span>4:3 · {data.tracks.length * 10} SEC</span>
          </div>
          <div className="shared-reel-copy">
            <p>{singleTrack ? "SHARED MUSIC CLIP" : "ONE LISTENER’S ROTATION"}</p>
            <h1>{singleTrack ? "Ten seconds from this track." : "Ten seconds from the favorites."}</h1>
            <ol>{data.tracks.map((track) => <li key={`${track.position}-${track.title}`}><span>{String(track.position).padStart(2, "0")}</span><div><strong>{track.title}</strong><small>{track.artists || "Unknown artist"}</small></div><em>10s</em></li>)}</ol>
            <a className="shared-reel-download" href={apiUrl(data.downloadUrl)}><FontAwesomeIcon icon={faDownload} /> Download MP4</a>
            <small className="shared-reel-expiry">Private link · expires {new Date(data.shareExpiresAt).toLocaleDateString()}</small>
          </div>
        </section>
      )}
    </main>
  );
}
