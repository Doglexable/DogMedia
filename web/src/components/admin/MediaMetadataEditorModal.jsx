import { useEffect, useMemo, useState } from "react";
import { api, mediaThumbnailUrl } from "../../api";
import { summarizeEncodingStatus } from "../../pages/admin-import-utils";
import { replaceMediaFilesInChunks } from "./MediaUploadWorkspace";

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 600,
    background: "var(--modal-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  modal: {
    width: "100%",
    maxWidth: 820,
    background: "var(--modal-bg)",
    color: "var(--modal-text)",
    borderRadius: 18,
    border: "1px solid var(--card-border)",
    boxShadow: "var(--modal-shadow)",
    overflow: "hidden",
    maxHeight: "92vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: "18px 20px",
    borderBottom: "1px solid var(--card-border)",
  },
  title: { margin: 0, fontSize: 18, fontWeight: 800 },
  subtitle: { margin: "4px 0 0", fontSize: 12, color: "var(--muted)" },
  close: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid var(--card-border)",
    background: "var(--bg)",
    color: "var(--text)",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    fontFamily: "inherit",
  },
  body: { padding: 18, overflowY: "auto" },
  grid: { display: "grid", gap: 16, alignItems: "start" },
  panel: {
    border: "1px solid var(--card-border)",
    borderRadius: 14,
    background: "var(--card-bg)",
    overflow: "hidden",
  },
  panelHeader: { padding: "16px 16px 12px", borderBottom: "1px solid var(--card-border)" },
  panelBody: { padding: 16 },
  cardTitle: { margin: 0, fontSize: "var(--fs-md)", fontWeight: 800, color: "var(--text)" },
  cardSubtitle: { marginTop: 4, marginBottom: 0, fontSize: "var(--fs-xs)", color: "var(--muted)" },
  fieldGroup: { marginBottom: 14 },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: "var(--muted)",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--card-border)",
    borderRadius: 10,
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
    fontFamily: "inherit",
  },
  textarea: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--card-border)",
    borderRadius: 10,
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
    resize: "vertical",
    minHeight: 84,
    fontFamily: "inherit",
  },
  fileInput: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--card-border)",
    borderRadius: 10,
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 14,
    boxSizing: "border-box",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  helpText: { marginTop: 6, fontSize: 11, color: "var(--muted)", lineHeight: 1.4 },
  editReplacementBox: {
    border: "1px dashed var(--card-border)",
    borderRadius: 12,
    background: "color-mix(in srgb, var(--primary) 5%, var(--bg))",
    padding: 12,
    marginBottom: 14,
  },
  actions: { display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", marginTop: 16 },
  button: (variant = "primary", disabled = false) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 10,
    background: variant === "primary" ? (disabled ? "var(--card-border)" : "var(--primary)") : (disabled ? "var(--bg)" : "var(--card-bg)"),
    color: variant === "primary" ? (disabled ? "var(--muted)" : "#fff") : (disabled ? "var(--muted)" : "var(--text)"),
    border: variant === "primary" ? "1px solid transparent" : "1px solid var(--card-border)",
    fontWeight: 700,
    fontSize: "var(--fs-sm)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.7 : 1,
    fontFamily: "inherit",
  }),
  error: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid var(--warning-border)",
    background: "var(--warning-bg)",
    color: "var(--warning-text)",
    fontSize: 13,
    marginBottom: 14,
  },
  spinner: {
    width: 14,
    height: 14,
    border: "2px solid rgba(255,255,255,0.4)",
    borderTopColor: "#fff",
    borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
    display: "inline-block",
  },
};

function formatDuration(totalSeconds) {
  const seconds = Number.parseInt(totalSeconds, 10);
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function readApiError(res, fallback) {
  const text = await res.text().catch(() => "");
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed.error || fallback;
  } catch {
    return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || fallback;
  }
}

function EncodingProgress({ detailed = false, status }) {
  const summary = summarizeEncodingStatus(status);
  if (!summary) return null;
  return (
    <div className={`admin-encoding-progress${detailed ? " admin-encoding-progress--detailed" : ""}`}>
      <div className="admin-encoding-progress__header">
        <span>{summary.label}</span>
        <strong>{summary.percent}%</strong>
      </div>
      <div
        className="admin-encoding-progress__track"
        role="progressbar"
        aria-label="Lower-resolution encoding progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={summary.percent}
      >
        <span style={{ width: `${summary.percent}%` }} />
      </div>
      {detailed && (
        <div className="admin-encoding-progress__qualities">
          {summary.qualities.map((item) => (
            <span key={item.quality} data-status={item.status}>
              {item.quality.toUpperCase()} · {item.status}{item.status === "processing" ? ` ${item.progress}%` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MediaMetadataEditorModal({
  isOpen,
  media = null,
  onClose,
  onSave,
  onOpenUploadQueue,
}) {
  const [mediaData, setMediaData] = useState(media);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [artists, setArtists] = useState("");
  const [trackOrder, setTrackOrder] = useState("");
  const [duration, setDuration] = useState("");
  const [offlineAllowed, setOfflineAllowed] = useState(false);
  const [file, setFile] = useState(null);
  const [artwork, setArtwork] = useState(null);
  const [artworkPreview, setArtworkPreview] = useState("");
  const [lyrics, setLyrics] = useState(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !media) return;
    setMediaData(media);
    setTitle(media.title || "");
    setDescription(media.description || "");
    setArtists(media.artists || "");
    setTrackOrder(media.track_order == null ? "" : String(media.track_order));
    setDuration(media.duration == null ? "" : String(media.duration));
    setOfflineAllowed(Boolean(media.offline_allowed));
    setFile(null);
    setArtwork(null);
    setLyrics(null);
    setSaving(false);
    setProgress(null);
    setError(null);
  }, [isOpen, media]);

  useEffect(() => {
    if (!mediaData) {
      setArtworkPreview("");
      return undefined;
    }
    if (!artwork) {
      setArtworkPreview(mediaThumbnailUrl(mediaData));
      return undefined;
    }

    const previewUrl = URL.createObjectURL(artwork);
    setArtworkPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [artwork, mediaData]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, saving]);

  const isDirty = useMemo(() => {
    if (!media) return false;
    return (
      title !== (media.title || "") ||
      description !== (media.description || "") ||
      artists !== (media.artists || "") ||
      trackOrder !== (media.track_order == null ? "" : String(media.track_order)) ||
      duration !== (media.duration == null ? "" : String(media.duration)) ||
      offlineAllowed !== Boolean(media.offline_allowed) ||
      file !== null ||
      artwork !== null ||
      lyrics !== null
    );
  }, [artists, artwork, description, duration, file, lyrics, media, offlineAllowed, title, trackOrder]);

  if (!isOpen || !mediaData) return null;

  const editingEncodingBusy = Object.values(mediaData.encoding_status || {})
    .some((item) => item.status === "queued" || item.status === "processing");

  const handleRetryEncoding = async ({ force = false } = {}) => {
    setError(null);
    const response = await api(`/api/media/${mediaData.id}/encoding/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    if (!response.ok) {
      setError(await readApiError(response, "Encoding retry failed"));
      return;
    }
    setMediaData((current) => ({
      ...current,
      encoding_status: Object.fromEntries(
        Object.entries(current.encoding_status || {}).map(([quality, value]) => [
          quality,
          force || value.status === "failed"
            ? { ...value, status: "queued", progress: 0, attempts: 0, error: null }
            : value,
        ])
      ),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    if (duration) {
      const parsedDuration = Number.parseFloat(duration);
      if (!Number.isFinite(parsedDuration) || parsedDuration < 0) {
        setError("Duration must be a valid non-negative number.");
        return;
      }
    }

    if (trackOrder && (!/^\d+$/.test(trackOrder) || Number.parseInt(trackOrder, 10) < 1)) {
      setError("Track order must be a positive integer.");
      return;
    }

    setSaving(true);
    setProgress(null);
    setError(null);

    try {
      const res = await api(`/api/media/${mediaData.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          artists: artists.trim() || null,
          track_order: trackOrder ? Number.parseInt(trackOrder, 10) : null,
          description: description || "",
          duration: duration ? Math.floor(Number.parseFloat(duration)) : null,
          offline_allowed: offlineAllowed,
        }),
      });

      if (!res.ok) throw new Error(await readApiError(res, "Edit failed"));

      let updated = await res.json();
      let replacementQueued = false;
      if (file || artwork || lyrics) {
        setProgress(0);
        const replacement = await replaceMediaFilesInChunks({
          mediaId: mediaData.id,
          file,
          thumbnail: artwork,
          lyricsFile: lyrics,
          onWorkerQueued: onOpenUploadQueue,
          onProgress: setProgress,
        });
        replacementQueued = replacement.queued;
        if (replacement.media) updated = replacement.media;
      }

      await onSave?.(updated, { replacementQueued });
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save changes");
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  return (
    <div className="admin-modal-overlay premium-modal-overlay" style={styles.overlay} onClick={saving ? undefined : onClose}>
      <div
        className="admin-modal premium-modal"
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal-header" style={styles.header}>
          <div>
            <h2 style={styles.title}>Edit {mediaData.title}</h2>
            <p style={styles.subtitle}>Update metadata, artwork, source files, and encoding.</p>
          </div>
          <button type="button" style={styles.close} disabled={saving} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="admin-modal-body" style={styles.body}>
          {error && <div style={styles.error}>{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="admin-modal-grid" style={styles.grid}>
              <section style={styles.panel}>
                <div style={styles.panelHeader}>
                  <h3 style={styles.cardTitle}>Metadata</h3>
                  <p style={styles.cardSubtitle}>These changes update the existing media row.</p>
                </div>
                <div style={styles.panelBody}>
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Title</label>
                    <input
                      style={styles.input}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Media title"
                      disabled={saving}
                    />
                  </div>

                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Artists</label>
                    <input
                      style={styles.input}
                      value={artists}
                      onChange={(e) => setArtists(e.target.value)}
                      placeholder="Unknown Artist"
                      disabled={saving}
                    />
                  </div>

                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Track Order</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      style={styles.input}
                      value={trackOrder}
                      onChange={(e) => setTrackOrder(e.target.value)}
                      placeholder="No stored track order"
                      disabled={saving}
                    />
                    <p style={styles.helpText}>Leave blank to clear the stored track order.</p>
                  </div>

                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Description</label>
                    <textarea
                      style={styles.textarea}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="A short description..."
                      disabled={saving}
                    />
                  </div>

                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>
                      Duration <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(seconds)</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      style={styles.input}
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      placeholder="180"
                      disabled={saving}
                    />
                    <p style={styles.helpText}>Leave blank to clear the stored duration; replacing the file can detect it again.</p>
                  </div>

                  {mediaData.mime_type?.startsWith("audio/") && (
                    <label className="admin-protection-option">
                      <input
                        type="checkbox"
                        checked={offlineAllowed}
                        onChange={(e) => setOfflineAllowed(e.target.checked)}
                        disabled={saving}
                      />
                      <span>
                        <strong>Allow offline download</strong>
                        <small>Keep disabled for stream-only media. Enable only when this audio may be stored in the mobile app.</small>
                      </span>
                    </label>
                  )}
                </div>
              </section>

              <section style={styles.panel}>
                <div style={styles.panelHeader}>
                  <h3 style={styles.cardTitle}>Replacement files</h3>
                  <p style={styles.cardSubtitle}>Choose only the assets you want to replace.</p>
                </div>
                <div style={styles.panelBody}>
                  <div style={styles.editReplacementBox}>
                    <div style={{ fontWeight: 800, color: "var(--text)", fontSize: 13 }}>Current file</div>
                    <div style={{ marginTop: 4, color: "var(--muted)", fontSize: 12 }}>
                      {mediaData.mime_type || "Unknown type"} · {mediaData.duration != null ? formatDuration(mediaData.duration) : "unknown duration"}
                    </div>
                    <EncodingProgress detailed status={mediaData.encoding_status} />
                    <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {Object.values(mediaData.encoding_status || {}).some((item) => item.status === "failed") && (
                        <button
                          type="button"
                          disabled={saving}
                          style={styles.button("secondary", saving)}
                          onClick={() => handleRetryEncoding()}
                        >
                          Retry failed
                        </button>
                      )}
                      {mediaData.mime_type?.startsWith("video/") && (
                        <button
                          type="button"
                          disabled={editingEncodingBusy || saving}
                          style={styles.button("secondary", editingEncodingBusy || saving)}
                          onClick={() => handleRetryEncoding({ force: true })}
                        >
                          {editingEncodingBusy ? "Encoding active" : "Re-encode video"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Replace media file</label>
                    <input
                      id="admin-edit-media-file"
                      type="file"
                      accept="video/*,audio/*,image/*"
                      onChange={(e) => setFile(e.target.files[0] || null)}
                      style={styles.fileInput}
                      disabled={saving}
                    />
                    <p style={styles.helpText}>Large files upload in chunks. If you replace this, the old media file is removed.</p>
                  </div>

                  {(mediaData.mime_type?.startsWith("video/") || mediaData.mime_type?.startsWith("image/")) && (
                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>Replace artwork</label>
                      <div className="admin-edit-artwork-row">
                        <img
                          className="admin-edit-artwork-preview"
                          src={artworkPreview}
                          alt={`${artwork ? "Selected" : "Current"} artwork for ${mediaData.title}`}
                        />
                        <div className="admin-edit-artwork-control">
                          <input
                            id="admin-edit-media-artwork"
                            type="file"
                            accept="image/*"
                            onChange={(e) => setArtwork(e.target.files[0] || null)}
                            style={styles.fileInput}
                            disabled={saving}
                          />
                          {artwork && (
                            <button
                              type="button"
                              className="admin-edit-artwork-reset"
                              disabled={saving}
                              onClick={() => {
                                setArtwork(null);
                                const el = document.getElementById("admin-edit-media-artwork");
                                if (el) el.value = "";
                              }}
                            >
                              Keep current artwork
                            </button>
                          )}
                          <p style={styles.helpText}>Choose a poster or still image. It will be resized and stored as this item’s artwork.</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Replace lyrics</label>
                    <input
                      id="admin-edit-media-lyrics"
                      type="file"
                      accept="application/json,.json"
                      onChange={(e) => setLyrics(e.target.files[0] || null)}
                      style={styles.fileInput}
                      disabled={saving}
                    />
                    <p style={styles.helpText}>Use Whisper JSON. Existing lyrics stay unchanged unless you choose a new file.</p>
                  </div>
                </div>
              </section>
            </div>

            <div style={styles.actions}>
              <button
                type="button"
                style={styles.button("secondary", saving)}
                disabled={saving}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !isDirty}
                style={styles.button("primary", saving || !isDirty)}
              >
                {saving && <span style={styles.spinner} />}
                {saving ? `Saving${progress === null ? "..." : ` ${progress}%`}` : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
