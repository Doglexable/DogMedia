import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons/faCheck";
import { faCopy } from "@fortawesome/free-solid-svg-icons/faCopy";
import { faFilm } from "@fortawesome/free-solid-svg-icons/faFilm";
import { faLinkSlash } from "@fortawesome/free-solid-svg-icons/faLinkSlash";
import { faShareNodes } from "@fortawesome/free-solid-svg-icons/faShareNodes";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { api } from "../../api";

const ACTIVE_STATUSES = new Set(["queued", "processing"]);

function absoluteShareUrl(sharePath) {
  return new URL(sharePath, window.location.origin).toString();
}

function reelTokenKey(reelId) {
  return `dogmedia:music-reel:${reelId}`;
}

function clampClipStart(value, duration) {
  const start = Math.max(0, Number(value) || 0);
  const maxStart = Math.max(0, (Number(duration) || 0) - 10);
  return Math.min(start, maxStart);
}

function formatClipTime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function statusCopy(status, singleTrack = false) {
  if (status === "queued") return "Your reel is in the render queue.";
  if (status === "processing") return singleTrack ? "The server is cutting a 10-second music clip." : "The server is cutting each track into a 10-second scene.";
  if (status === "ready") return singleTrack ? "Your 4:3 music clip is ready to share." : "Your 4:3 music reel is ready to share.";
  if (status === "failed") return "The server could not finish this reel.";
  return singleTrack ? "Turn this song into a shareable music clip." : "Choose the tracks that belong in your reel.";
}

export function MusicReelDialog({ favorites, onClose, singleTrack = false, initialStart = 0, duration = 0 }) {
  const trackDuration = Number(duration || favorites[0]?.duration || 0);
  const maxClipStart = Math.max(0, trackDuration - 10);
  const [selectedIds, setSelectedIds] = useState(() => singleTrack && favorites[0] ? [Number(favorites[0].id)] : []);
  const [reel, setReel] = useState({ loading: true, enabled: false });
  const [shareUrl, setShareUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [clipStart, setClipStart] = useState(() => clampClipStart(initialStart, trackDuration));
  const [lyrics, setLyrics] = useState([]);
  const [lyricsLoading, setLyricsLoading] = useState(singleTrack);
  const [selectedLyricIndex, setSelectedLyricIndex] = useState(null);

  const selectedOrder = useMemo(
    () => new Map(selectedIds.map((id, index) => [Number(id), index + 1])),
    [selectedIds]
  );

  const applyReel = (data) => {
    const expectedSingleId = Number(favorites[0]?.id);
    const reelMediaIds = Array.isArray(data?.mediaIds) ? data.mediaIds.map(Number) : [];
    if (singleTrack && data?.enabled && (reelMediaIds.length !== 1 || reelMediaIds[0] !== expectedSingleId)) {
      setReel({ loading: false, enabled: false, replacing: true });
      setShareUrl("");
      return;
    }
    setReel({ loading: false, ...data });
    if (!data?.reelId) return;
    const token = data.token || window.sessionStorage.getItem(reelTokenKey(data.reelId));
    if (data.token) window.sessionStorage.setItem(reelTokenKey(data.reelId), data.token);
    if (token) setShareUrl(absoluteShareUrl(`/shared/music#${token}`));
  };

  const readStatus = () => api("/api/music-shares/current")
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not read reel status");
      applyReel(data);
      return data;
    });

  useEffect(() => {
    let cancelled = false;
    readStatus().catch((error) => {
      if (!cancelled) setReel({ loading: false, enabled: false, error: error.message });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!singleTrack || !favorites[0]?.id) return undefined;
    const controller = new AbortController();
    setLyricsLoading(true);
    api(`/api/media/${Number(favorites[0].id)}/lyrics`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 404) return [];
          throw new Error(data.error || "Lyrics unavailable");
        }
        return Array.isArray(data.segments) ? data.segments : [];
      })
      .then((segments) => setLyrics(segments.filter((segment) => Number.isFinite(Number(segment?.start)))))
      .catch((error) => {
        if (error.name !== "AbortError") setLyrics([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLyricsLoading(false);
      });
    return () => controller.abort();
  }, [favorites[0]?.id, singleTrack]);

  useEffect(() => {
    if (!ACTIVE_STATUSES.has(reel.status)) return undefined;
    const interval = window.setInterval(() => readStatus().catch(() => {}), 2000);
    return () => window.clearInterval(interval);
  }, [reel.status]);

  const toggleTrack = (mediaId) => {
    const id = Number(mediaId);
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((selectedId) => selectedId !== id);
      if (current.length >= 10) {
        setNotice("A reel can contain at most 10 tracks.");
        return current;
      }
      setNotice("");
      return [...current, id];
    });
  };

  const createReel = async () => {
    if (!selectedIds.length) {
      setNotice(singleTrack ? "This track cannot be shared." : "Choose at least one favorite track.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await api("/api/music-shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaIds: selectedIds,
          expiresInDays: 1,
          ...(singleTrack ? { clipStarts: [clipStart] } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not start the reel");
      applyReel(data);
      setNotice("Rendering started. You can keep this window open or come back later.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const createReplacementLink = async () => {
    const response = await api("/api/music-shares/current/link", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not create a share link");
    applyReel(data);
    const url = absoluteShareUrl(data.sharePath);
    setShareUrl(url);
    return url;
  };

  const copyLink = async (providedUrl) => {
    try {
      const requestedUrl = typeof providedUrl === "string" ? providedUrl : shareUrl;
      const url = requestedUrl || await createReplacementLink();
      await navigator.clipboard.writeText(url);
      setNotice("Link copied.");
    } catch (error) {
      setNotice(error.message || "Select the link and copy it manually.");
    }
  };

  const shareLink = async () => {
    setBusy(true);
    try {
      const url = shareUrl || await createReplacementLink();
      if (!navigator.share) {
        await copyLink(url);
        return;
      }
      await navigator.share({
        title: singleTrack ? favorites[0]?.title || "Dogmedia music clip" : "My Dogmedia Top 10",
        text: singleTrack ? `A 10-second clip from ${favorites[0]?.title || "this track"}` : "Ten seconds from each of my favorite tracks",
        url,
      });
    } catch (error) {
      if (error.name !== "AbortError") setNotice("The link could not be shared.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      const response = await api("/api/music-shares/current", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not revoke the reel");
      if (reel.reelId) window.sessionStorage.removeItem(reelTokenKey(reel.reelId));
      setReel({ loading: false, enabled: false });
      setShareUrl("");
      setNotice("The reel link has been revoked.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const rendering = ACTIVE_STATUSES.has(reel.status);
  const canShare = reel.status === "ready";

  return (
    <div className="music-share-overlay music-reel-overlay" role="presentation">
      <button type="button" className="music-share-dismiss" aria-label="Close music reel" onClick={onClose} />
      <section className="music-share-dialog music-reel-dialog" role="dialog" aria-modal="true" aria-labelledby="music-reel-title">
        <header className="music-share-header">
          <div><span>10 seconds · 4:3 video</span><h2 id="music-reel-title">{singleTrack ? "Share this music" : "Build your favorite reel"}</h2></div>
          <button type="button" className="music-share-icon-button" aria-label="Close music reel" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
        </header>

        <div className="music-reel-stage">
          <div className="music-reel-frame" aria-hidden="true">
            <span>4:3</span><strong>{selectedIds.length || reel.trackCount || 0}</strong><small>{singleTrack ? "TRACK" : "TRACKS"}</small>
          </div>
          <div>
            <p className="music-reel-stage-label">{reel.status || "New reel"}</p>
            <h3>{statusCopy(reel.status, singleTrack)}</h3>
            <p>{rendering ? "Rendering happens on the server. The share page will update automatically." : singleTrack ? reel.replacing ? "Choose a moment below. Sharing this song will replace your previous active reel link." : "Choose the exact 10-second moment, or tap a lyric to begin two seconds before it. This song does not need to be in Favorites." : "Your selection order becomes the video order. Each clip starts two seconds before its first timed lyric."}</p>
          </div>
        </div>

        {rendering || reel.status === "ready" || reel.status === "failed" ? (
          <div className="music-reel-processing" aria-live="polite">
            <div className="music-reel-progress-copy"><span>{reel.status === "ready" ? "Render complete" : reel.status === "failed" ? "Render stopped" : "Preparing video"}</span><strong>{reel.progress || 0}%</strong></div>
            <div className="music-reel-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={reel.progress || 0}><span style={{ width: `${reel.progress || 0}%` }} /></div>
            {shareUrl && <div className="music-share-link-row"><input readOnly value={shareUrl} aria-label="Secret reel link" onFocus={(event) => event.target.select()} /><button type="button" aria-label="Copy link" onClick={copyLink}><FontAwesomeIcon icon={faCopy} /></button></div>}
            {reel.error && <p className="music-share-notice music-share-notice--error" role="alert">{reel.error}</p>}
          </div>
        ) : (
          <div className="music-reel-builder">
            {!singleTrack && <div className="music-reel-counter"><strong>{selectedIds.length}/10</strong><span>Tap favorites in the order they should play.</span></div>}
            <ol className="music-reel-track-list">
              {favorites.map((item) => {
                const order = selectedOrder.get(Number(item.id));
                return <li key={item.id}><button type="button" className={order ? "is-selected" : ""} aria-pressed={Boolean(order)} disabled={singleTrack} onClick={() => toggleTrack(item.id)}><span className="music-reel-order">{order || "+"}</span><span><strong>{item.title}</strong><small>{item.artists || item.category_name || "Unknown artist"}</small></span><em>10s</em></button></li>;
              })}
            </ol>
            {singleTrack && (
              <section className="music-clip-picker" aria-labelledby="music-clip-picker-title">
                <div className="music-clip-picker-heading">
                  <div><span>Choose the moment</span><h3 id="music-clip-picker-title">Your 10-second window</h3></div>
                  <strong>{formatClipTime(clipStart)}–{formatClipTime(Math.min(trackDuration || clipStart + 10, clipStart + 10))}</strong>
                </div>
                <div className="music-clip-window" aria-hidden="true"><span style={{ left: `${trackDuration ? (clipStart / trackDuration) * 100 : 0}%`, width: `${trackDuration ? Math.min(100, (10 / trackDuration) * 100) : 100}%` }} /></div>
                <input
                  className="music-clip-range"
                  type="range"
                  min="0"
                  max={maxClipStart}
                  step="0.1"
                  value={clipStart}
                  disabled={maxClipStart === 0}
                  aria-label="Clip start time"
                  aria-valuetext={`From ${formatClipTime(clipStart)} to ${formatClipTime(Math.min(trackDuration || clipStart + 10, clipStart + 10))}`}
                  onChange={(event) => {
                    setClipStart(clampClipStart(event.target.value, trackDuration));
                    setSelectedLyricIndex(null);
                  }}
                />
                <div className="music-clip-scale"><span>0:00</span><span>{formatClipTime(trackDuration)}</span></div>
                <div className="music-clip-lyrics" aria-label="Choose a lyric for the clip">
                  {lyricsLoading ? <p>Loading timed lyrics…</p> : lyrics.length ? lyrics.map((segment, index) => (
                    <button
                      key={`${segment.start}-${index}`}
                      type="button"
                      className={selectedLyricIndex === index ? "is-selected" : ""}
                      aria-pressed={selectedLyricIndex === index}
                      onClick={() => {
                        setClipStart(clampClipStart(Number(segment.start) - 2, trackDuration));
                        setSelectedLyricIndex(index);
                      }}
                    >
                      <time>{formatClipTime(segment.start)}</time><span>{segment.text || "Instrumental"}</span>
                    </button>
                  )) : <p>No timed lyrics found. Drag the timeline to choose the start.</p>}
                </div>
              </section>
            )}
            <p className="music-reel-retention">The rendered video and its private link are removed after 24 hours.</p>
          </div>
        )}

        {notice && <p className="music-share-notice" role="status"><FontAwesomeIcon icon={canShare ? faCheck : faFilm} /> {notice}</p>}
        <footer className="music-share-footer">
          {reel.enabled && <button type="button" className="music-share-revoke" disabled={busy} onClick={revoke}><FontAwesomeIcon icon={faLinkSlash} /> Revoke</button>}
          {!reel.enabled && <button type="button" className="music-share-primary" disabled={busy || reel.loading || !selectedIds.length} onClick={createReel}><FontAwesomeIcon icon={faFilm} /> {busy ? "Starting…" : singleTrack ? "Render clip" : "Render reel"}</button>}
          {canShare && <button type="button" className="music-share-primary" disabled={busy} onClick={shareLink}><FontAwesomeIcon icon={faShareNodes} /> {busy ? "Creating link…" : singleTrack ? "Share clip" : "Share reel"}</button>}
        </footer>
      </section>
    </div>
  );
}
