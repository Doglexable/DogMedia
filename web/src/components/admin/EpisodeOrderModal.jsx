import { useEffect, useState } from "react";

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
  error: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid var(--warning-border)",
    background: "var(--warning-bg)",
    color: "var(--warning-text)",
    fontSize: 13,
    marginBottom: 14,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    maxHeight: "56vh",
    overflowY: "auto",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "70px 1fr auto",
    gap: 12,
    alignItems: "center",
    padding: "10px 12px",
    border: "1px solid var(--card-border)",
    borderRadius: 12,
    background: "var(--bg)",
  },
  orderInput: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid var(--card-border)",
    borderRadius: 8,
    background: "var(--card-bg)",
    color: "var(--text)",
    fontSize: 13,
    textAlign: "center",
    fontWeight: 700,
    outline: "none",
    boxSizing: "border-box",
  },
  titleInput: {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid var(--card-border)",
    borderRadius: 8,
    background: "var(--card-bg)",
    color: "var(--text)",
    fontSize: 13,
    fontWeight: 600,
    outline: "none",
    boxSizing: "border-box",
  },
  meta: {
    fontSize: 11,
    color: "var(--muted)",
    marginTop: 2,
  },
  actionsCol: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  stepButton: {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid var(--card-border)",
    background: "var(--card-bg)",
    color: "var(--text)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 18,
    flexWrap: "wrap",
  },
  hint: {
    fontSize: 12,
    color: "var(--muted)",
    margin: 0,
  },
  footerButtons: {
    display: "flex",
    gap: 10,
  },
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

export default function EpisodeOrderModal({
  isOpen,
  episodes = [],
  onClose,
  onSaveOrder,
}) {
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    const sorted = [...episodes].sort((a, b) => {
      const aTrack = Number.isInteger(Number(a.track_order)) && Number(a.track_order) >= 1
        ? Number(a.track_order)
        : Number.POSITIVE_INFINITY;
      const bTrack = Number.isInteger(Number(b.track_order)) && Number(b.track_order) >= 1
        ? Number(b.track_order)
        : Number.POSITIVE_INFINITY;
      return aTrack - bTrack || Number(a.id) - Number(b.id);
    });

    setItems(
      sorted.map((item, index) => ({
        id: item.id,
        title: item.title || "",
        trackOrder: String(item.track_order ?? index + 1),
        duration: item.duration,
        mimeType: item.mime_type,
      }))
    );
    setSaving(false);
    setError(null);
  }, [episodes, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, saving]);

  if (!isOpen) return null;

  const updateItemOrder = (id, trackOrder) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, trackOrder } : item))
    );
  };

  const updateItemTitle = (id, title) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, title } : item))
    );
  };

  const moveItem = (index, delta) => {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    // Re-index track orders sequentially
    setItems(next.map((item, idx) => ({ ...item, trackOrder: String(idx + 1) })));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const orders = items.map((item) => Number.parseInt(item.trackOrder, 10));
    if (orders.some((value) => !Number.isInteger(value) || value < 1)) {
      setError("Every episode must have a valid positive order number.");
      return;
    }

    if (new Set(orders).size !== orders.length) {
      setError("Order numbers must be unique across all episodes.");
      return;
    }

    if (items.some((item) => !item.title.trim())) {
      setError("Episode title cannot be empty.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSaveOrder(items);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save episode order.");
    } finally {
      setSaving(false);
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
            <h2 style={styles.title}>Episode sequence & titles</h2>
            <p style={styles.subtitle}>Reorder video episodes and adjust batch display titles.</p>
          </div>
          <button type="button" style={styles.close} disabled={saving} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="admin-modal-body" style={styles.body}>
          {error && <div style={styles.error}>{error}</div>}

          <form onSubmit={handleSubmit}>
            <div style={styles.list}>
              {items.map((item, index) => (
                <div key={item.id} style={styles.row}>
                  <label>
                    <input
                      aria-label={`Order for ${item.title}`}
                      type="number"
                      min="1"
                      style={styles.orderInput}
                      value={item.trackOrder}
                      onChange={(e) => updateItemOrder(item.id, e.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <div>
                    <input
                      aria-label={`Title for ${item.title}`}
                      style={styles.titleInput}
                      value={item.title}
                      onChange={(e) => updateItemTitle(item.id, e.target.value)}
                      disabled={saving}
                    />
                    <div style={styles.meta}>
                      {item.duration != null ? formatDuration(item.duration) : "Unknown duration"}
                      {" · "}
                      {item.mimeType || "video"}
                    </div>
                  </div>
                  <div style={styles.actionsCol}>
                    <button
                      type="button"
                      style={styles.stepButton}
                      disabled={saving || index === 0}
                      onClick={() => moveItem(index, -1)}
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      style={styles.stepButton}
                      disabled={saving || index === items.length - 1}
                      onClick={() => moveItem(index, 1)}
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div style={styles.footer}>
              <p style={styles.hint}>Lower order numbers play first. Titles update directly.</p>
              <div style={styles.footerButtons}>
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
                  disabled={saving}
                  style={styles.button("primary", saving)}
                >
                  {saving && <span style={styles.spinner} />}
                  {saving ? "Saving..." : "Save Order"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
