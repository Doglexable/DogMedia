import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck } from "@fortawesome/free-solid-svg-icons/faCircleCheck";
import { faCloudArrowUp } from "@fortawesome/free-solid-svg-icons/faCloudArrowUp";
import { faDownload } from "@fortawesome/free-solid-svg-icons/faDownload";
import { faFileShield } from "@fortawesome/free-solid-svg-icons/faFileShield";
import { faFilm } from "@fortawesome/free-solid-svg-icons/faFilm";
import { faFolderOpen } from "@fortawesome/free-solid-svg-icons/faFolderOpen";
import { faMusic } from "@fortawesome/free-solid-svg-icons/faMusic";
import { faMobileScreenButton } from "@fortawesome/free-solid-svg-icons/faMobileScreenButton";
import { faTrash } from "@fortawesome/free-solid-svg-icons/faTrash";
import { useAccess } from "../access-context";
import { api, apiUrl, mediaThumbnailUrl } from "../api";
import { useLibrary } from "../components/library-shell";
import { CategoryTreeDnd } from "../components/admin/category-tree-dnd";
import { useGlobalPlayerLibrary } from "../components/GlobalPlayer";
import { buildBatchItems, buildVideoItems, estimateUploadRemaining, formatUploadRemaining, getExt, summarizeEncodingStatus } from "./admin-import-utils";
import "./admin-media-import.css";

const FALLBACK_CHUNK_SIZE = 4 * 1024 * 1024;

const styles = {
  page: {
    minHeight: "100vh",
    background: "var(--bg)",
    color: "var(--text)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "0 24px",
    minHeight: "var(--app-header-height)",
    borderBottom: "1px solid var(--card-border)",
    background: "var(--card-bg)",
    position: "sticky",
    top: 0,
    zIndex: 100,
    flexWrap: "wrap",
  },
  headerBlock: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  headerTitle: {
    fontWeight: 800,
    fontSize: "var(--fs-lg)",
    color: "var(--text)",
    letterSpacing: "-0.02em",
  },
  headerNote: {
    fontSize: "var(--fs-xs)",
    color: "var(--muted)",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  main: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "28px 20px 40px",
    display: "grid",
    gap: 18,
  },
  mainWithPlayer: {
    paddingBottom: "calc(var(--player-height) + 38px)",
  },
  notice: (type) => ({
    padding: "12px 14px",
    borderRadius: 10,
    border: `1px solid var(--${type === "error" ? "warning" : "success"}-border)`,
    background: `var(--${type === "error" ? "warning" : "success"}-bg)`,
    color: `var(--${type === "error" ? "warning" : "success"}-text)`,
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    gap: 8,
  }),
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "18px 20px",
    border: "1px solid var(--card-border)",
    borderRadius: 16,
    background: "linear-gradient(180deg, var(--card-bg), var(--bg))",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.04)",
    flexWrap: "wrap",
  },
  toolbarCopy: {
    minWidth: 0,
  },
  toolbarLabel: {
    fontSize: "var(--fs-xs)",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--muted)",
    marginBottom: 4,
    fontWeight: 700,
  },
  toolbarValue: {
    fontSize: "var(--fs-md)",
    fontWeight: 700,
    color: "var(--text)",
    lineHeight: 1.3,
    wordBreak: "break-word",
  },
  toolbarMeta: {
    marginTop: 4,
    fontSize: "var(--fs-xs)",
    color: "var(--muted)",
  },
  actionRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "flex-end",
  },
  button: (variant = "primary", disabled = false) => {
    const palette = {
      primary: {
        background: disabled ? "var(--card-border)" : "var(--primary)",
        color: disabled ? "var(--muted)" : "#fff",
        border: "1px solid transparent",
      },
      secondary: {
        background: disabled ? "var(--bg)" : "var(--card-bg)",
        color: disabled ? "var(--muted)" : "var(--text)",
        border: "1px solid var(--card-border)",
      },
      danger: {
        background: disabled ? "var(--bg)" : "var(--warning-bg)",
        color: disabled ? "var(--muted)" : "var(--warning-text)",
        border: "1px solid var(--warning-border)",
      },
    }[variant];

    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: "10px 14px",
      borderRadius: 10,
      background: palette.background,
      color: palette.color,
      border: palette.border,
      fontWeight: 700,
      fontSize: "var(--fs-sm)",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "transform 0.15s, opacity 0.15s, background 0.15s",
      opacity: disabled ? 0.7 : 1,
      fontFamily: "inherit",
    };
  },
  tableCard: {
    border: "1px solid var(--card-border)",
    borderRadius: 16,
    background: "var(--card-bg)",
    overflow: "hidden",
  },
  tableHeader: {
    padding: "18px 20px 14px",
    borderBottom: "1px solid var(--card-border)",
  },
  cardTitle: {
    margin: 0,
    fontSize: "var(--fs-md)",
    fontWeight: 800,
    color: "var(--text)",
  },
  cardSubtitle: {
    marginTop: 4,
    marginBottom: 0,
    fontSize: "var(--fs-xs)",
    color: "var(--muted)",
  },
  tableWrap: {
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: "12px 16px",
    borderBottom: "1px solid var(--table-border)",
    fontWeight: 700,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--muted)",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px 16px",
    borderBottom: "1px solid var(--table-border-light)",
    verticalAlign: "middle",
  },
  selectedRow: {
    background: "var(--bg)",
  },
  categoryCell: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text)",
  },
  categoryHint: {
    fontSize: 12,
    color: "var(--muted)",
  },
  pathText: {
    fontSize: 12,
    color: "var(--muted)",
    lineHeight: 1.4,
  },
  tierBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 8px",
    borderRadius: 999,
    border: "1px solid var(--card-border)",
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 12,
    fontWeight: 700,
  },
  rowActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  emptyState: {
    padding: "34px 24px",
    textAlign: "center",
    color: "var(--muted)",
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  modalOverlay: {
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
  modalHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: "18px 20px",
    borderBottom: "1px solid var(--card-border)",
  },
  modalTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 800,
  },
  modalSubtitle: {
    margin: "4px 0 0",
    fontSize: 12,
    color: "var(--muted)",
  },
  modalBody: {
    padding: 18,
    overflowY: "auto",
  },
  modalClose: {
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
  modalGrid: {
    display: "grid",
    gap: 16,
    alignItems: "start",
  },
  panel: {
    border: "1px solid var(--card-border)",
    borderRadius: 14,
    background: "var(--card-bg)",
    overflow: "hidden",
  },
  panelHeader: {
    padding: "16px 16px 12px",
    borderBottom: "1px solid var(--card-border)",
  },
  panelBody: {
    padding: 16,
  },
  fieldGroup: {
    marginBottom: 14,
  },
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
  select: {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid var(--card-border)",
    borderRadius: 10,
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 14,
    boxSizing: "border-box",
    outline: "none",
    cursor: "pointer",
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
  helpText: {
    marginTop: 6,
    fontSize: 11,
    color: "var(--muted)",
    lineHeight: 1.4,
  },
  divider: {
    height: 1,
    background: "var(--card-border)",
    margin: "18px 0",
  },
  batchPreview: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxHeight: 220,
    overflowY: "auto",
    marginTop: 10,
  },
  batchSummary: {
    display: "grid",
    gap: 8,
    marginTop: 10,
  },
  batchSummaryItem: {
    border: "1px solid var(--card-border)",
    borderRadius: 10,
    background: "var(--bg)",
    padding: "10px 12px",
  },
  batchSummaryLabel: {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--muted)",
  },
  batchSummaryValue: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: 800,
    color: "var(--text)",
  },
  batchItem: {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 10,
    alignItems: "center",
    padding: "10px 12px",
    border: "1px solid var(--card-border)",
    borderRadius: 10,
    background: "var(--bg)",
  },
  batchTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  batchMeta: {
    marginTop: 3,
    fontSize: 11,
    color: "var(--muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  batchBadge: {
    border: "1px solid var(--card-border)",
    borderRadius: 999,
    padding: "3px 8px",
    color: "var(--muted)",
    fontSize: 11,
    whiteSpace: "nowrap",
  },
  mediaList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  mediaItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 12px",
    border: "1px solid var(--card-border)",
    borderRadius: 12,
    background: "var(--bg)",
  },
  mediaTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text)",
    marginBottom: 4,
  },
  mediaMeta: {
    fontSize: 12,
    color: "var(--muted)",
  },
  editReplacementBox: {
    border: "1px dashed var(--card-border)",
    borderRadius: 12,
    background: "color-mix(in srgb, var(--primary) 5%, var(--bg))",
    padding: 12,
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

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value;
  let unit = "B";
  for (const nextUnit of units) {
    size /= 1024;
    unit = nextUnit;
    if (size < 1024) break;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
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

function orderCategories(categories) {
  return [...categories].sort((a, b) =>
    Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
    a.name.localeCompare(b.name) ||
    Number(a.id) - Number(b.id)
  );
}

function orderMedia(items) {
  return [...items].sort((a, b) => {
    const aTrack = Number.isInteger(Number(a.track_order)) && Number(a.track_order) >= 1
      ? Number(a.track_order)
      : Number.POSITIVE_INFINITY;
    const bTrack = Number.isInteger(Number(b.track_order)) && Number(b.track_order) >= 1
      ? Number(b.track_order)
      : Number.POSITIVE_INFINITY;
    return aTrack - bTrack
      || Number(a.id) - Number(b.id);
  });
}

function applyCategoryMove(categories, categoryId, parentId, index) {
  const numericId = Number(categoryId);
  const normalizedParentId = parentId == null ? null : Number(parentId);
  const moved = categories.find((category) => Number(category.id) === numericId);
  if (!moved) return categories;

  const oldParentId = moved.parent_id == null ? null : Number(moved.parent_id);
  const destination = orderCategories(categories.filter((category) =>
    Number(category.id) !== numericId &&
    (category.parent_id == null ? null : Number(category.parent_id)) === normalizedParentId
  ));
  destination.splice(Math.min(Math.max(index, 0), destination.length), 0, moved);

  const positions = new Map(destination.map((category, position) => [Number(category.id), position]));
  if (oldParentId !== normalizedParentId) {
    orderCategories(categories.filter((category) =>
      Number(category.id) !== numericId &&
      (category.parent_id == null ? null : Number(category.parent_id)) === oldParentId
    )).forEach((category, position) => positions.set(Number(category.id), position));
  }

  const parent = normalizedParentId == null
    ? null
    : categories.find((category) => Number(category.id) === normalizedParentId);
  const descendantIds = new Set([numericId]);
  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const category of categories) {
      if (!descendantIds.has(Number(category.id)) && descendantIds.has(Number(category.parent_id))) {
        descendantIds.add(Number(category.id));
        foundDescendant = true;
      }
    }
  }

  const updated = categories.map((category) => {
    const id = Number(category.id);
    const changes = positions.has(id) ? { sort_order: positions.get(id) } : {};
    if (id === numericId) changes.parent_id = normalizedParentId;
    if (parent && descendantIds.has(id)) changes.min_access_tier = parent.min_access_tier;
    return Object.keys(changes).length ? { ...category, ...changes } : category;
  });

  const childrenByParent = new Map();
  for (const category of updated) {
    const key = category.parent_id ?? null;
    const children = childrenByParent.get(key) || [];
    children.push(category);
    childrenByParent.set(key, children);
  }
  const treeData = new Map();
  const walk = (currentParent = null, depth = 0, pathParts = []) => {
    for (const child of orderCategories(childrenByParent.get(currentParent) || [])) {
      const nextPath = [...pathParts, child.name];
      treeData.set(Number(child.id), { depth, path: nextPath.join(" / ") });
      walk(child.id, depth + 1, nextPath);
    }
  };
  walk();
  return updated.map((category) => ({ ...category, ...treeData.get(Number(category.id)) }));
}

function Modal({ title, subtitle, children, onClose, width = 960 }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="admin-modal-overlay premium-modal-overlay" style={styles.modalOverlay} onClick={onClose}>
      <div
        className="admin-modal premium-modal"
        style={{ ...styles.modal, maxWidth: width }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-modal-header" style={styles.modalHeader}>
          <div>
            <h2 style={styles.modalTitle}>{title}</h2>
            {subtitle && <p style={styles.modalSubtitle}>{subtitle}</p>}
          </div>
          <button type="button" style={styles.modalClose} onClick={onClose}>
            Close
          </button>
        </div>
        <div className="admin-modal-body" style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

function formatQueueAge(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "just now";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function BrowserTransferProgress({ compact = false, onOpenQueue, transfer }) {
  if (!transfer) return null;
  const numericProgress = Number(transfer.progress);
  const progress = transfer.progress !== null && transfer.progress !== undefined && Number.isFinite(numericProgress)
    ? Math.min(100, Math.max(0, Math.round(numericProgress)))
    : null;

  return (
    <article className={`admin-browser-transfer${compact ? " admin-browser-transfer--compact" : ""}`} role="status" aria-live="polite">
      <div className="admin-browser-transfer-icon" aria-hidden="true">
        <FontAwesomeIcon icon={faCloudArrowUp} />
      </div>
      <div className="admin-browser-transfer-main">
        <div className="admin-browser-transfer-heading">
          <div>
            <span>Browser transfer</span>
            <strong>{transfer.title}</strong>
          </div>
          <b>{progress === null ? "Working" : `${progress}%`}</b>
        </div>
        <div
          className={`admin-browser-transfer-track${progress === null ? " admin-browser-transfer-track--indeterminate" : ""}`}
          role="progressbar"
          aria-label={transfer.title}
          aria-valuemin="0"
          aria-valuemax="100"
          {...(progress === null ? {} : { "aria-valuenow": progress })}
        >
          <span style={progress === null ? undefined : { width: `${progress}%` }} />
        </div>
        <p>{transfer.detail} Do not refresh or close this tab.</p>
      </div>
      {!compact && onOpenQueue && (
        <button type="button" onClick={onOpenQueue}>View queue</button>
      )}
    </article>
  );
}

function UploadQueuePanel({ browserTransfer, error, jobs, loading, onRefresh, summary }) {
  const activeCount = (summary?.queued || 0) + (summary?.processing || 0);
  return (
    <div className="admin-upload-queue">
      <BrowserTransferProgress compact transfer={browserTransfer} />
      <div className="admin-upload-queue-summary">
        <div><span>Active</span><strong>{activeCount}</strong></div>
        <div><span>Queued</span><strong>{summary?.queued || 0}</strong></div>
        <div><span>Completed</span><strong>{summary?.completed || 0}</strong></div>
        <div><span>Failed</span><strong>{summary?.failed || 0}</strong></div>
      </div>

      <div className="admin-upload-queue-toolbar">
        <p>This view follows the server worker. You may close it while processing continues.</p>
        <button type="button" onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <div className="admin-upload-queue-error" role="alert">{error}</div>}
      {!error && !loading && jobs.length === 0 && (
        <div className="admin-upload-queue-empty">No upload jobs have been recorded in the last 24 hours.</div>
      )}
      {jobs.length > 0 && (
        <div className="admin-upload-queue-list">
          {jobs.map((job) => {
            const statusLabel = job.status === "queued"
              ? `Queue position ${job.queuePosition || "—"} · added ${formatQueueAge(job.queuedAt)}`
              : job.status === "processing"
                ? `Worker is assembling and indexing · started ${formatQueueAge(job.startedAt)}`
                : job.status === "completed"
                  ? `Media is ready · ${formatQueueAge(job.finishedAt)}`
                  : job.error || "Worker failed";
            return (
              <article className="admin-upload-queue-job" data-status={job.status} key={job.uploadId}>
                <div className="admin-upload-queue-job-main">
                  <strong title={job.title || job.fileName}>{job.title || job.fileName || "Untitled upload"}</strong>
                  <span>{job.fileName || (job.replacementMediaId ? `Replacement for media #${job.replacementMediaId}` : job.uploadId)}</span>
                </div>
                <div className="admin-upload-queue-job-status">
                  <strong>{job.status || "unknown"}</strong>
                  <span>{statusLabel}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function clearFileInputs() {
  const mediaInput = document.getElementById("admin-media-file");
  const thumbInput = document.getElementById("admin-media-thumb");
  const categoryCoverInput = document.getElementById("admin-category-cover-file");
  const lyricsInput = document.getElementById("admin-media-lyrics");
  const batchFolderInput = document.getElementById("admin-media-batch-folder");
  const batchFilesInput = document.getElementById("admin-media-batch-files");
  const editFileInput = document.getElementById("admin-edit-media-file");
  const editArtworkInput = document.getElementById("admin-edit-media-artwork");
  const editLyricsInput = document.getElementById("admin-edit-media-lyrics");
  if (mediaInput) mediaInput.value = "";
  if (thumbInput) thumbInput.value = "";
  if (categoryCoverInput) categoryCoverInput.value = "";
  if (lyricsInput) lyricsInput.value = "";
  if (batchFolderInput) batchFolderInput.value = "";
  if (batchFilesInput) batchFilesInput.value = "";
  if (editFileInput) editFileInput.value = "";
  if (editArtworkInput) editArtworkInput.value = "";
  if (editLyricsInput) editLyricsInput.value = "";
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

async function readLyricsFile(file) {
  if (!file) return null;
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error(`"${file.name}" is not valid JSON.`);
  }
}

async function uploadCategoryCover(categoryId, file) {
  const form = new FormData();
  form.append("thumbnail", file, file.name);
  const response = await api(`/api/categories/${categoryId}/thumbnail`, { method: "PUT", body: form });
  if (!response.ok) throw new Error(await readApiError(response, "Category cover upload failed"));
  return response.json();
}

async function sendFileChunks({ uploadId, file, kind, chunkSize, onProgress, startedAt, uploadedBytes, totalBytes }) {
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  let sentBytes = uploadedBytes;

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("index", String(index));
    fd.append("chunk", chunk, file.name);

    const res = await api(`/api/media/uploads/${uploadId}/chunks`, { method: "POST", body: fd });
    if (!res.ok) {
      throw new Error(await readApiError(res, `Chunk upload failed (${res.status})`));
    }

    sentBytes += chunk.size;
    onProgress?.(
      Math.min(100, Math.round((sentBytes / totalBytes) * 100)),
      estimateUploadRemaining({
        elapsedMs: performance.now() - startedAt,
        uploadedBytes: sentBytes,
        totalBytes,
      })
    );
  }

  return sentBytes;
}

async function uploadMediaInChunks({ categoryId, title, description = "", artists = "", trackOrder = "", duration = "", contentKind = "", file, lyricsFile = null, thumbnail = null, onProgress, onWorkerQueued }) {
  const lyrics = await readLyricsFile(lyricsFile);
  const initRes = await api("/api/media/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category_id: categoryId,
      title,
      description,
      artists,
      track_order: trackOrder,
      duration,
      content_kind: contentKind,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      thumbnailName: thumbnail?.name || "",
      thumbnailSize: thumbnail?.size || 0,
      thumbnailType: thumbnail?.type || "",
      lyrics,
    }),
  });

  if (!initRes.ok) {
    throw new Error(await readApiError(initRes, `Upload setup failed (${initRes.status})`));
  }

  const { uploadId, chunkSize = FALLBACK_CHUNK_SIZE } = await initRes.json();
  const totalBytes = Math.max(1, file.size + (thumbnail?.size || 0));
  let uploadedBytes = 0;
  let queuedForWorker = false;
  const startedAt = performance.now();

  try {
    uploadedBytes = await sendFileChunks({
      uploadId,
      file,
      kind: "file",
      chunkSize,
      onProgress,
      startedAt,
      uploadedBytes,
      totalBytes,
    });

    if (thumbnail) {
      await sendFileChunks({
        uploadId,
        file: thumbnail,
        kind: "thumbnail",
        chunkSize,
        onProgress,
        startedAt,
        uploadedBytes,
        totalBytes,
      });
    }

    const completeRes = await api(`/api/media/uploads/${uploadId}/complete`, { method: "POST" });
    if (!completeRes.ok) {
      throw new Error(await readApiError(completeRes, `Upload finalization failed (${completeRes.status})`));
    }
    const completionResult = await completeRes.json();
    if (completeRes.status === 202) {
      queuedForWorker = true;
      onWorkerQueued?.(uploadId);
      return { uploadId, queued: true, status: completionResult.status || "queued" };
    }
    return { uploadId, queued: false, media: completionResult, status: "completed" };
  } catch (error) {
    if (!queuedForWorker) {
      await api(`/api/media/uploads/${uploadId}`, { method: "DELETE" }).catch(() => {});
    }
    throw error;
  }
}

async function replaceMediaFilesInChunks({ mediaId, file = null, lyricsFile = null, thumbnail = null, onProgress, onWorkerQueued }) {
  const lyrics = lyricsFile ? await readLyricsFile(lyricsFile) : null;
  const initRes = await api("/api/media/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      replaceMediaId: mediaId,
      fileName: file?.name || "",
      fileSize: file?.size || 0,
      fileType: file?.type || "",
      thumbnailName: thumbnail?.name || "",
      thumbnailSize: thumbnail?.size || 0,
      thumbnailType: thumbnail?.type || "",
      lyrics,
    }),
  });

  if (!initRes.ok) {
    throw new Error(await readApiError(initRes, `Replacement setup failed (${initRes.status})`));
  }

  const { uploadId, chunkSize = FALLBACK_CHUNK_SIZE } = await initRes.json();
  const totalBytes = Math.max(1, (file?.size || 0) + (thumbnail?.size || 0));
  let uploadedBytes = 0;
  let queuedForWorker = false;
  const startedAt = performance.now();

  try {
    if (file) {
      uploadedBytes = await sendFileChunks({
        uploadId,
        file,
        kind: "file",
        chunkSize,
        onProgress,
        startedAt,
        uploadedBytes,
        totalBytes,
      });
    }

    if (thumbnail) {
      await sendFileChunks({
        uploadId,
        file: thumbnail,
        kind: "thumbnail",
        chunkSize,
        onProgress,
        startedAt,
        uploadedBytes,
        totalBytes,
      });
    }

    const completeRes = await api(`/api/media/uploads/${uploadId}/complete`, { method: "POST" });
    if (!completeRes.ok) {
      throw new Error(await readApiError(completeRes, `Replacement finalization failed (${completeRes.status})`));
    }
    const completionResult = await completeRes.json();
    if (completeRes.status === 202) {
      queuedForWorker = true;
      onWorkerQueued?.(uploadId);
      return { uploadId, queued: true, status: completionResult.status || "queued" };
    }
    return { uploadId, queued: false, media: completionResult, status: "completed" };
  } catch (error) {
    if (!queuedForWorker) {
      await api(`/api/media/uploads/${uploadId}`, { method: "DELETE" }).catch(() => {});
    }
    throw error;
  }
}

async function uploadAndroidRelease({ file, version, onProgress }) {
  const initRes = await api("/api/mobile-release/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, filename: file.name, size: file.size }),
  });

  if (!initRes.ok) {
    throw new Error(await readApiError(initRes, `Release upload setup failed (${initRes.status})`));
  }

  const { uploadId, chunkSize = FALLBACK_CHUNK_SIZE } = await initRes.json();
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * chunkSize;
      const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
      const form = new FormData();
      form.append("index", String(index));
      form.append("chunk", chunk, file.name);

      const chunkRes = await api(`/api/mobile-release/uploads/${uploadId}/chunks`, {
        method: "POST",
        body: form,
      });
      if (!chunkRes.ok) {
        throw new Error(await readApiError(chunkRes, `APK chunk upload failed (${chunkRes.status})`));
      }
      onProgress?.(Math.round(((index + 1) / totalChunks) * 100));
    }

    const completeRes = await api(`/api/mobile-release/uploads/${uploadId}/complete`, { method: "POST" });
    if (!completeRes.ok) {
      throw new Error(await readApiError(completeRes, `Release finalization failed (${completeRes.status})`));
    }
    return completeRes.json();
  } catch (error) {
    await api(`/api/mobile-release/uploads/${uploadId}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

function FolderArtworkEditor({ category, file, onFileChange, onSubmit, updating }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const currentUrl = category?.cover_path
    ? apiUrl(`/api/categories/${category.id}/thumbnail?v=${encodeURIComponent(category.cover_path)}`)
    : "";

  useEffect(() => {
    setPreviewFailed(false);
    if (!file) {
      setPreviewUrl(currentUrl);
      return undefined;
    }

    const selectedUrl = URL.createObjectURL(file);
    setPreviewUrl(selectedUrl);
    return () => URL.revokeObjectURL(selectedUrl);
  }, [currentUrl, file]);

  const categoryName = category?.name || "Selected folder";
  const showPreview = previewUrl && !previewFailed;

  return (
    <section className="admin-folder-artwork" aria-labelledby="admin-folder-artwork-title">
      <div className="admin-folder-artwork-visual">
        {showPreview ? (
          <img
            key={previewUrl}
            className={file ? "admin-folder-artwork-image admin-folder-artwork-image--selected" : "admin-folder-artwork-image"}
            src={previewUrl}
            alt={`Folder artwork for ${categoryName}`}
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <span className="admin-folder-artwork-fallback" aria-hidden="true">{categoryName.slice(0, 1).toUpperCase()}</span>
        )}
        <span className="admin-folder-artwork-tag">Folder art</span>
      </div>

      <div className="admin-folder-artwork-copy">
        <span>Shared attachment</span>
        <h3 id="admin-folder-artwork-title">Folder artwork</h3>
        <p>Used as the shared cover for this music album or anime series.</p>
      </div>

      <form className="admin-folder-artwork-form" onSubmit={onSubmit}>
        <label className="admin-folder-artwork-picker" htmlFor="admin-category-cover-file">
          <span>{file ? "Artwork selected" : category?.cover_path ? "Replace artwork" : "Attach artwork"}</span>
          <small>{file?.name || "Choose a JPG, PNG, or WebP image"}</small>
        </label>
        <input
          id="admin-category-cover-file"
          className="admin-folder-artwork-input"
          type="file"
          accept="image/*"
          onChange={(event) => onFileChange(event.target.files[0] || null)}
        />
        <button
          type="submit"
          disabled={updating || !file || !category}
          style={styles.button("secondary", updating || !file || !category)}
        >
          {updating && <span style={styles.spinner} />}
          {updating ? "Updating..." : "Save artwork"}
        </button>
      </form>
    </section>
  );
}

export default function Admin() {
  const { tier } = useAccess();
  const { categories: globalCategories, refreshCategories: refreshGlobalCategories } = useLibrary();
  const player = useGlobalPlayerLibrary();
  const [categories, setCategories] = useState(globalCategories);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [message, setMessage] = useState(null);
  const [movingCategory, setMovingCategory] = useState(false);

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryParentId, setCategoryParentId] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryDescription, setNewCategoryDescription] = useState("");
  const [newCategoryTier, setNewCategoryTier] = useState("0");
  const [creatingCategory, setCreatingCategory] = useState(false);

  const [mediaModalCategoryId, setMediaModalCategoryId] = useState(null);
  const [mediaWorkspaceTab, setMediaWorkspaceTab] = useState("collection");
  const [videoKind, setVideoKind] = useState("episode");
  const [categoryMedia, setCategoryMedia] = useState([]);
  const [mediaDescription, setMediaDescription] = useState("");
  const [videoFiles, setVideoFiles] = useState([]);
  const [videoOverrides, setVideoOverrides] = useState({});
  const [mediaThumb, setMediaThumb] = useState(null);
  const [categoryCoverFile, setCategoryCoverFile] = useState(null);
  const [updatingCategoryCover, setUpdatingCategoryCover] = useState(false);
  const [batchFiles, setBatchFiles] = useState([]);
  const [batchArtist, setBatchArtist] = useState("");
  const [batchOverrides, setBatchOverrides] = useState({});
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadingBatch, setUploadingBatch] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [batchProgress, setBatchProgress] = useState(null);
  const [uploadEtaSeconds, setUploadEtaSeconds] = useState(null);
  const [batchEtaSeconds, setBatchEtaSeconds] = useState(null);
  const [reorderingVideos, setReorderingVideos] = useState(false);
  const [videoOrderDraft, setVideoOrderDraft] = useState({});
  const [savingVideoOrder, setSavingVideoOrder] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [editingMedia, setEditingMedia] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editArtists, setEditArtists] = useState("");
  const [editTrackOrder, setEditTrackOrder] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [editOfflineAllowed, setEditOfflineAllowed] = useState(false);
  const [editFile, setEditFile] = useState(null);
  const [editArtwork, setEditArtwork] = useState(null);
  const [editArtworkPreview, setEditArtworkPreview] = useState("");
  const [editLyrics, setEditLyrics] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editProgress, setEditProgress] = useState(null);
  const [scanningTrackOrders, setScanningTrackOrders] = useState(false);
  const [mobileRelease, setMobileRelease] = useState(null);
  const [releaseVersion, setReleaseVersion] = useState("0.1.0");
  const [releaseFile, setReleaseFile] = useState(null);
  const [uploadingRelease, setUploadingRelease] = useState(false);
  const [releaseProgress, setReleaseProgress] = useState(null);
  const [uploadQueueOpen, setUploadQueueOpen] = useState(false);
  const [uploadQueueJobs, setUploadQueueJobs] = useState([]);
  const [uploadQueueSummary, setUploadQueueSummary] = useState({ queued: 0, processing: 0, completed: 0, failed: 0 });
  const [uploadQueueLoading, setUploadQueueLoading] = useState(false);
  const [uploadQueueError, setUploadQueueError] = useState("");
  const mediaUploadActive = uploadingMedia || uploadingBatch || updatingCategoryCover;
  const browserTransferActive = mediaUploadActive || uploadingRelease || savingEdit;

  useEffect(() => {
    if (!editingMedia) {
      setEditArtworkPreview("");
      return undefined;
    }
    if (!editArtwork) {
      setEditArtworkPreview(mediaThumbnailUrl(editingMedia));
      return undefined;
    }

    const previewUrl = URL.createObjectURL(editArtwork);
    setEditArtworkPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [editArtwork, editingMedia]);

  const refreshUploadQueue = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setUploadQueueLoading(true);
    try {
      const response = await api("/api/media/uploads/queue");
      if (!response.ok) throw new Error(await readApiError(response, "Could not load the upload worker queue"));
      const data = await response.json();
      setUploadQueueJobs(Array.isArray(data.jobs) ? data.jobs : []);
      setUploadQueueSummary(data.summary || { queued: 0, processing: 0, completed: 0, failed: 0 });
      setUploadQueueError("");
    } catch (error) {
      setUploadQueueError(error.message);
    } finally {
      if (!silent) setUploadQueueLoading(false);
    }
  }, []);

  const openUploadQueue = useCallback(() => {
    setUploadQueueOpen(true);
    void refreshUploadQueue();
  }, [refreshUploadQueue]);

  useEffect(() => {
    void refreshUploadQueue({ silent: true });
  }, [refreshUploadQueue]);

  useEffect(() => {
    const activeJobs = uploadQueueSummary.queued + uploadQueueSummary.processing;
    if (!uploadQueueOpen && activeJobs === 0) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshUploadQueue({ silent: true });
    };
    const interval = window.setInterval(refreshWhenVisible, uploadQueueOpen ? 1500 : 5000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshUploadQueue, uploadQueueOpen, uploadQueueSummary.processing, uploadQueueSummary.queued]);

  useEffect(() => {
    let cancelled = false;

    const loadMobileRelease = async () => {
      try {
        const res = await api("/api/mobile-release");
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) {
          setMobileRelease(data);
          if (data.available && data.version) setReleaseVersion(data.version);
        }
      } catch {
        if (!cancelled) setMobileRelease({ available: false });
      }
    };

    loadMobileRelease();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCategories(globalCategories);
  }, [globalCategories]);

  useEffect(() => {
    if (!browserTransferActive) return undefined;

    const warnBeforeRefresh = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeRefresh);
    return () => window.removeEventListener("beforeunload", warnBeforeRefresh);
  }, [browserTransferActive]);

  useEffect(() => {
    if (!categoryModalOpen && mediaModalCategoryId === null && editingMedia === null) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [categoryModalOpen, mediaModalCategoryId, editingMedia]);

  useEffect(() => {
    if (mediaModalCategoryId === null) return;

    let cancelled = false;
    const loadMedia = async () => {
      setLoadingMedia(true);
      try {
        const res = await api(`/api/media?category_id=${mediaModalCategoryId}`);
        const data = await res.json();
        if (!cancelled) {
          setCategoryMedia(Array.isArray(data) ? orderMedia(data) : []);
        }
      } catch {
        if (!cancelled) {
          setMessage({ type: "error", text: "Failed to load category media." });
        }
      } finally {
        if (!cancelled) setLoadingMedia(false);
      }
    };

    loadMedia();

    return () => {
      cancelled = true;
    };
  }, [mediaModalCategoryId]);

  const batchItems = useMemo(() => buildBatchItems(batchFiles), [batchFiles]);
  const videoItems = useMemo(() => buildVideoItems(videoFiles), [videoFiles]);
  const videoHasInvalidRows = useMemo(() => {
    const orders = [];
    const invalid = videoItems.some((item) => {
      const override = videoOverrides[item.key] || {};
      const title = String(override.title ?? item.title).trim();
      const trackOrder = String(override.trackOrder ?? item.trackOrder).trim();
      orders.push(trackOrder);
      return !title || !/^\d+$/.test(trackOrder) || Number(trackOrder) < 1;
    });
    return invalid || new Set(orders).size !== orders.length;
  }, [videoItems, videoOverrides]);
  const filmSelectionInvalid = videoKind === "film" && videoItems.length !== 1;
  const batchHasInvalidRows = useMemo(() => batchItems.some((item) => {
    const override = batchOverrides[item.key] || {};
    const title = String(override.title ?? item.title).trim();
    const trackOrder = override.trackOrder ?? item.trackOrder ?? "";
    return !title || (String(trackOrder).trim() !== "" && (!/^\d+$/.test(String(trackOrder)) || Number(trackOrder) < 1));
  }), [batchItems, batchOverrides]);
  const batchSummary = useMemo(() => ({
    files: batchFiles.length,
    tracks: batchItems.length,
    covers: new Set(batchItems.filter((item) => item.thumbnail).map((item) => item.thumbnail)).size,
    lyrics: batchItems.filter((item) => item.lyrics).length,
    skipped: batchItems.reduce((sum, item) => sum + item.skippedCount, 0),
    bytes: batchItems.reduce((sum, item) => sum + (item.file?.size || 0), 0),
  }), [batchFiles, batchItems]);
  const activeBrowserTransfer = uploadingMedia
    ? {
        title: `Uploading ${videoItems.length} video${videoItems.length === 1 ? "" : "s"}`,
        progress: uploadProgress,
        detail: uploadProgress >= 100 ? "Transfer complete; waiting for the media worker." : formatUploadRemaining(uploadEtaSeconds),
      }
    : uploadingBatch
      ? {
          title: `Importing ${batchItems.length} music track${batchItems.length === 1 ? "" : "s"}`,
          progress: batchProgress,
          detail: batchProgress >= 100 ? "Transfer complete; waiting for the media worker." : formatUploadRemaining(batchEtaSeconds),
        }
      : updatingCategoryCover
        ? { title: "Updating folder artwork", progress: null, detail: "Uploading and optimizing the new cover." }
        : uploadingRelease
          ? { title: `Uploading Android ${releaseVersion.trim() || "release"}`, progress: releaseProgress, detail: "Sending the APK to the server." }
          : savingEdit
            ? {
                title: `Updating ${editingMedia?.title || "media"}`,
                progress: editProgress,
                detail: editProgress === null ? "Saving media information." : "Uploading replacement files.",
              }
            : null;

  if (tier < 100) return <Navigate to="/" replace />;

  const categoryRows = categories;
  const selectedCategory = selectedCategoryId
    ? categories.find((category) => String(category.id) === String(selectedCategoryId))
    : null;
  const activeMediaCategory = mediaModalCategoryId
    ? categories.find((category) => String(category.id) === String(mediaModalCategoryId))
    : null;

  const openCategoryModal = (parentId = "") => {
    const parentCategory = parentId
      ? categories.find((category) => String(category.id) === String(parentId))
      : null;
    setMessage(null);
    setMediaModalCategoryId(null);
    setCategoryParentId(parentId ? String(parentId) : "");
    setNewCategoryName("");
    setNewCategoryDescription("");
    setNewCategoryTier(parentCategory ? String(parentCategory.min_access_tier) : "0");
    setCategoryModalOpen(true);
  };

  const closeCategoryModal = () => {
    setCategoryModalOpen(false);
  };

  const openMediaModal = (categoryId) => {
    setMessage(null);
    setCategoryModalOpen(false);
    setMediaModalCategoryId(String(categoryId));
    setMediaWorkspaceTab("collection");
    setVideoKind("episode");
    setCategoryMedia([]);
    setMediaDescription("");
    setVideoFiles([]);
    setVideoOverrides({});
    setMediaThumb(null);
    setCategoryCoverFile(null);
    setUpdatingCategoryCover(false);
    setBatchFiles([]);
    setBatchArtist("");
    setBatchOverrides({});
    setReorderingVideos(false);
    setVideoOrderDraft({});
    setEditingMedia(null);
    clearFileInputs();
    setSelectedCategoryId(String(categoryId));
  };

  const closeMediaModal = () => {
    setMediaModalCategoryId(null);
    setCategoryMedia([]);
    setLoadingMedia(false);
    if (!mediaUploadActive) {
      setMediaDescription("");
      setVideoFiles([]);
      setVideoOverrides({});
      setMediaThumb(null);
      setCategoryCoverFile(null);
      setBatchFiles([]);
      setBatchArtist("");
      setBatchOverrides({});
      clearFileInputs();
    }
    setReorderingVideos(false);
    setVideoOrderDraft({});
    setEditingMedia(null);
  };

  const openEditMediaModal = (media) => {
    setMessage(null);
    setEditingMedia(media);
    setEditTitle(media.title || "");
    setEditDescription(media.description || "");
    setEditArtists(media.artists || "");
    setEditTrackOrder(media.track_order == null ? "" : String(media.track_order));
    setEditDuration(media.duration == null ? "" : String(media.duration));
    setEditOfflineAllowed(Boolean(media.offline_allowed));
    setEditFile(null);
    setEditArtwork(null);
    setEditLyrics(null);
    setEditProgress(null);
    clearFileInputs();
  };

  const closeEditMediaModal = () => {
    setEditingMedia(null);
    setEditTitle("");
    setEditDescription("");
    setEditArtists("");
    setEditTrackOrder("");
    setEditDuration("");
    setEditOfflineAllowed(false);
    setEditFile(null);
    setEditArtwork(null);
    setEditLyrics(null);
    setEditProgress(null);
    clearFileInputs();
  };

  const refreshCategories = async () => {
    const data = await refreshGlobalCategories();
    if (!Array.isArray(data)) throw new Error("Failed to refresh categories");
    setCategories(data);
  };

  const refreshCategoryMedia = async (fallbackItems) => {
    try {
      const response = await api(`/api/media?category_id=${mediaModalCategoryId}`);
      if (!response.ok) throw new Error("Category media refresh failed");
      const items = await response.json();
      if (!Array.isArray(items)) throw new Error("Invalid category media response");
      const orderedItems = orderMedia(items);
      setCategoryMedia(orderedItems);
      return orderedItems;
    } catch {
      const orderedItems = orderMedia(fallbackItems);
      setCategoryMedia(orderedItems);
      return orderedItems;
    }
  };

  const handleUpdateCategoryCover = async (event) => {
    event.preventDefault();
    if (!mediaModalCategoryId || !categoryCoverFile) {
      setMessage({ type: "error", text: "Choose an image for the category cover." });
      return;
    }

    setUpdatingCategoryCover(true);
    setMessage(null);
    try {
      await uploadCategoryCover(mediaModalCategoryId, categoryCoverFile);
      await refreshCategories();
      setCategoryCoverFile(null);
      const input = document.getElementById("admin-category-cover-file");
      if (input) input.value = "";
      setMessage({ type: "success", text: `Updated the cover for "${activeMediaCategory?.path || activeMediaCategory?.name || "the selected category"}".` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setUpdatingCategoryCover(false);
    }
  };

  const handleCreateCategory = async (event) => {
    event.preventDefault();
    if (!newCategoryName.trim()) {
      setMessage({ type: "error", text: "Category name is required." });
      return;
    }

    setCreatingCategory(true);
    setMessage(null);

    try {
      const res = await api("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCategoryName.trim(),
          description: newCategoryDescription,
          min_access_tier: Number.parseInt(newCategoryTier, 10) || 0,
          parent_id: categoryParentId ? Number.parseInt(categoryParentId, 10) : null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create category");
      }

      const created = await res.json();
      await refreshCategories();
      setSelectedCategoryId(String(created.id));
      setCategoryModalOpen(false);
      setMessage({ type: "success", text: `Category "${created.name}" created.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleDeleteCategory = async (category) => {
    const hasChildren =
      Number(category.child_count || 0) > 0 ||
      categories.some((candidate) => String(candidate.parent_id) === String(category.id));

    if (hasChildren) {
      setMessage({ type: "error", text: "Delete child categories before deleting this category." });
      return;
    }

    if (!window.confirm(`Delete category "${category.path || category.name}"? Media in this category will also be removed from the library.`)) {
      return;
    }

    try {
      const res = await api(`/api/categories/${category.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Delete failed");
      }

      await refreshCategories();
      if (String(selectedCategoryId) === String(category.id)) {
        setSelectedCategoryId(null);
      }
      setMessage({ type: "success", text: `Deleted category "${category.name}".` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  const handleMoveCategory = async (categoryId, parentId, index) => {
    if (movingCategory) return false;

    const moved = categories.find((category) => Number(category.id) === Number(categoryId));
    if (!moved) return false;
    const currentParent = moved.parent_id == null ? null : Number(moved.parent_id);
    const currentIndex = orderCategories(categories.filter((category) =>
      (category.parent_id == null ? null : Number(category.parent_id)) === currentParent
    )).findIndex((category) => Number(category.id) === Number(categoryId));
    if (currentParent === parentId && currentIndex === index) return true;

    const previous = categories;
    const optimistic = applyCategoryMove(categories, categoryId, parentId, index);
    let persisted = false;
    setMovingCategory(true);
    setSelectedCategoryId(String(categoryId));
    setCategories(optimistic);
    setMessage(null);

    try {
      const response = await api(`/api/categories/${categoryId}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId, index }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Could not move category");
      }
      persisted = true;
      await refreshCategories();
      setMessage({ type: "success", text: `Moved "${moved.name}" successfully.` });
      return true;
    } catch (error) {
      if (persisted) {
        setCategories(optimistic);
        setMessage({ type: "error", text: `Category moved, but the tree could not be refreshed: ${error.message}` });
        return true;
      }
      setCategories(previous);
      setMessage({ type: "error", text: error.message });
      return false;
    } finally {
      setMovingCategory(false);
    }
  };

  const handleUploadMedia = async (event) => {
    event.preventDefault();

    if (!mediaModalCategoryId || videoItems.length === 0) {
      setMessage({ type: "error", text: "Choose a category and at least one supported video file." });
      return;
    }

    if (filmSelectionInvalid) {
      setMessage({ type: "error", text: "Choose exactly one video file for a film." });
      return;
    }

    if (videoHasInvalidRows) {
      setMessage({ type: "error", text: "Every video needs a title and a positive order number." });
      return;
    }

    setUploadingMedia(true);
    setUploadProgress(0);
    setUploadEtaSeconds(null);
    setMessage(null);

    const completedItems = [];
    let queuedCount = 0;
    const failures = [];
    let queueShown = false;
    const showQueueOnce = () => {
      if (queueShown) return;
      queueShown = true;
      openUploadQueue();
    };
    for (const [itemIndex, item] of videoItems.entries()) {
      const override = videoOverrides[item.key] || {};
      try {
        const result = await uploadMediaInChunks({
          categoryId: mediaModalCategoryId,
          title: String(override.title ?? item.title).trim(),
          description: mediaDescription,
          artists: "",
          trackOrder: override.trackOrder ?? item.trackOrder,
          duration: "",
          contentKind: videoKind === "episode" ? "video_episode" : videoKind === "film" ? "film" : "video",
          file: item.file,
          lyricsFile: null,
          thumbnail: mediaThumb,
          onWorkerQueued: showQueueOnce,
          onProgress: (progress, estimate) => {
            setUploadProgress(Math.round(((itemIndex + progress / 100) / videoItems.length) * 100));
            const remainingFilesBytes = videoItems
              .slice(itemIndex + 1)
              .reduce((total, nextItem) => total + nextItem.file.size + (mediaThumb?.size || 0), 0);
            setUploadEtaSeconds(estimate
              ? Math.ceil(estimate.remainingSeconds + remainingFilesBytes / estimate.bytesPerSecond)
              : null);
          },
        });
        if (result.queued) queuedCount += 1;
        else if (result.media) completedItems.push(result.media);
      } catch (error) {
        failures.push(`${item.file.name}: ${error.message}`);
      }
    }

    try {
      if (completedItems.length > 0) {
        const nextMedia = await refreshCategoryMedia([...categoryMedia, ...completedItems]);
        await refreshCategories().catch(() => {});
        const videos = nextMedia.filter((item) => item.mime_type?.startsWith("video/"));
        setVideoOrderDraft(Object.fromEntries(videos.map((item, index) => [item.id, String(item.track_order || index + 1)])));
        setReorderingVideos(true);
        setMediaWorkspaceTab("collection");
      }
      if (queuedCount + completedItems.length > 0) {
        setMediaDescription("");
        setVideoFiles([]);
        setVideoOverrides({});
        setMediaThumb(null);
        clearFileInputs();
      }
      const acceptedCount = queuedCount + completedItems.length;
      setMessage(failures.length === 0
        ? { type: "success", text: `${acceptedCount} video upload${acceptedCount === 1 ? "" : "s"} accepted.${queuedCount ? ` The worker will finish ${queuedCount} in the background.` : ""}` }
        : { type: "error", text: `Queued ${acceptedCount}, failed ${failures.length}. ${failures.slice(0, 2).join(" ")}` });
    } finally {
      setUploadingMedia(false);
      setUploadProgress(null);
      setUploadEtaSeconds(null);
    }
  };

  const openVideoOrdering = () => {
    const videos = orderMedia(categoryMedia.filter((item) => item.mime_type?.startsWith("video/")));
    setVideoOrderDraft(Object.fromEntries(videos.map((item, index) => [item.id, String(item.track_order || index + 1)])));
    setReorderingVideos(true);
    setMessage(null);
  };

  const handleSaveVideoOrder = async () => {
    const videos = categoryMedia.filter((item) => item.mime_type?.startsWith("video/"));
    const orders = videos.map((item) => Number.parseInt(videoOrderDraft[item.id], 10));
    if (orders.some((value) => !Number.isInteger(value) || value < 1) || new Set(orders).size !== orders.length) {
      setMessage({ type: "error", text: "Use a unique positive order number for every video." });
      return;
    }

    setSavingVideoOrder(true);
    setMessage(null);
    try {
      const updated = await Promise.all(videos.map(async (item) => {
        const response = await api(`/api/media/${item.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ track_order: videoOrderDraft[item.id] }),
        });
        if (!response.ok) throw new Error(await readApiError(response, `Could not reorder ${item.title}`));
        return response.json();
      }));
      const updatedById = new Map(updated.map((item) => [Number(item.id), item]));
      setCategoryMedia((current) => orderMedia(current.map((item) => updatedById.get(Number(item.id)) || item)));
      setReorderingVideos(false);
      setMessage({ type: "success", text: "Video order saved." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSavingVideoOrder(false);
    }
  };

  const handleUploadBatch = async (event) => {
    event.preventDefault();

    if (!mediaModalCategoryId || batchItems.length === 0) {
      setMessage({ type: "error", text: "Choose a category and at least one audio file to import." });
      return;
    }

    setUploadingBatch(true);
    setBatchProgress(0);
    setBatchEtaSeconds(null);
    setMessage(null);

    const completedItems = [];
    let queuedCount = 0;
    const failures = [];
    let queueShown = false;
    const showQueueOnce = () => {
      if (queueShown) return;
      queueShown = true;
      openUploadQueue();
    };

    const batchCover = batchItems.find((item) => item.thumbnail)?.thumbnail || null;
    if (batchCover) {
      try {
        await uploadCategoryCover(mediaModalCategoryId, batchCover);
        await refreshCategories();
      } catch (error) {
        setUploadingBatch(false);
        setBatchProgress(null);
        setBatchEtaSeconds(null);
        setMessage({ type: "error", text: error.message });
        return;
      }
    }

    for (const [itemIndex, item] of batchItems.entries()) {
      try {
        const override = batchOverrides[item.key] || {};
        const result = await uploadMediaInChunks({
          categoryId: mediaModalCategoryId,
          title: String(override.title || item.title).trim(),
          artists: batchArtist,
          trackOrder: override.trackOrder ?? item.trackOrder ?? "",
          contentKind: "music",
          file: item.file,
          lyricsFile: item.lyrics,
          thumbnail: null,
          onWorkerQueued: showQueueOnce,
          onProgress: (progress, estimate) => {
            setBatchProgress(Math.round(((itemIndex + progress / 100) / batchItems.length) * 100));
            const remainingFilesBytes = batchItems
              .slice(itemIndex + 1)
              .reduce((total, nextItem) => total + nextItem.file.size, 0);
            setBatchEtaSeconds(estimate
              ? Math.ceil(estimate.remainingSeconds + remainingFilesBytes / estimate.bytesPerSecond)
              : null);
          },
        });
        if (result.queued) queuedCount += 1;
        else if (result.media) completedItems.push(result.media);
      } catch (error) {
        failures.push(`${item.title}: ${error.message}`);
      }
    }

    if (completedItems.length > 0) {
      await refreshCategoryMedia([...categoryMedia, ...completedItems]);
      await refreshCategories().catch(() => {});
    }

    const acceptedCount = queuedCount + completedItems.length;
    if (acceptedCount > 0) {
      setBatchFiles([]);
      setBatchArtist("");
      setBatchOverrides({});
      clearFileInputs();
    }
    if (failures.length === 0) {
      setMessage({ type: "success", text: `${acceptedCount} track upload${acceptedCount === 1 ? "" : "s"} accepted.${queuedCount ? ` The worker will finish ${queuedCount} in the background.` : ""}` });
    } else {
      setMessage({
        type: "error",
        text: `Queued ${acceptedCount}, failed ${failures.length}. ${failures.slice(0, 2).join(" ")}`,
      });
    }

    setUploadingBatch(false);
    setBatchProgress(null);
    setBatchEtaSeconds(null);
  };

  const handleDeleteMedia = async (media) => {
    if (!window.confirm(`Are you sure you want to delete "${media.title}"? This cannot be undone.`)) return;

    try {
      const res = await api(`/api/media/${media.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setCategoryMedia((prev) => prev.filter((item) => item.id !== media.id));
      setMessage({ type: "success", text: `Deleted "${media.title}".` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  const handleScanTrackOrders = async () => {
    if (!window.confirm("Scan track numbers from every audio file? Valid embedded tags will replace stored track orders.")) return;

    setScanningTrackOrders(true);
    setMessage(null);
    try {
      const response = await api("/api/media/track-orders/scan", { method: "POST" });
      if (!response.ok) throw new Error(await readApiError(response, "Track metadata scan failed"));
      const result = await response.json();

      if (mediaModalCategoryId !== null) {
        const mediaResponse = await api(`/api/media?category_id=${mediaModalCategoryId}`);
        if (!mediaResponse.ok) throw new Error(await readApiError(mediaResponse, "Media refresh failed"));
        const mediaItems = await mediaResponse.json();
        setCategoryMedia(Array.isArray(mediaItems) ? orderMedia(mediaItems) : []);
      }

      setMessage({
        type: result.failed ? "error" : "success",
        text: `Track scan complete: ${result.scanned} scanned, ${result.updated} updated, ${result.missing} without a track tag, ${result.failed} failed.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setScanningTrackOrders(false);
    }
  };

  const handleSaveMediaEdit = async (event) => {
    event.preventDefault();
    if (!editingMedia) return;

    if (!editTitle.trim()) {
      setMessage({ type: "error", text: "Title is required." });
      return;
    }

    if (editDuration) {
      const parsedDuration = Number.parseFloat(editDuration);
      if (!Number.isFinite(parsedDuration) || parsedDuration < 0) {
        setMessage({ type: "error", text: "Duration must be a valid non-negative number." });
        return;
      }
    }

    if (editTrackOrder && (!/^\d+$/.test(editTrackOrder) || Number.parseInt(editTrackOrder, 10) < 1)) {
      setMessage({ type: "error", text: "Track order must be a positive integer." });
      return;
    }

    setSavingEdit(true);
    setEditProgress(null);
    setMessage(null);

    try {
      const res = await api(`/api/media/${editingMedia.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          artists: editArtists.trim() || null,
          track_order: editTrackOrder ? Number.parseInt(editTrackOrder, 10) : null,
          description: editDescription || "",
          duration: editDuration ? Math.floor(Number.parseFloat(editDuration)) : null,
          offline_allowed: editOfflineAllowed,
        }),
      });

      if (!res.ok) throw new Error(await readApiError(res, "Edit failed"));

      let updated = await res.json();
      let replacementQueued = false;
      if (editFile || editArtwork || editLyrics) {
        setEditProgress(0);
        const replacement = await replaceMediaFilesInChunks({
          mediaId: editingMedia.id,
          file: editFile,
          thumbnail: editArtwork,
          lyricsFile: editLyrics,
          onWorkerQueued: openUploadQueue,
          onProgress: setEditProgress,
        });
        replacementQueued = replacement.queued;
        if (replacement.media) updated = replacement.media;
      }

      setCategoryMedia((prev) => orderMedia(prev.map((item) => (item.id === editingMedia.id ? updated : item))));
      setMessage({
        type: "success",
        text: replacementQueued
          ? `Changes saved for "${updated.title}". File processing continues in the background.`
          : `Updated "${updated.title}".`,
      });
      closeEditMediaModal();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setSavingEdit(false);
      setEditProgress(null);
    }
  };

  const handleRetryEncoding = async ({ force = false } = {}) => {
    if (!editingMedia) return;
    const response = await api(`/api/media/${editingMedia.id}/encoding/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    if (!response.ok) {
      setMessage({ type: "error", text: await readApiError(response, "Encoding retry failed") });
      return;
    }
    setEditingMedia((current) => ({
      ...current,
      encoding_status: Object.fromEntries(Object.entries(current.encoding_status || {}).map(([quality, value]) => [
        quality, force || value.status === "failed" ? { ...value, status: "queued", progress: 0, attempts: 0, error: null } : value,
      ])),
    }));
    setMessage({ type: "success", text: `${force ? "Re-encoding" : "Encoding retry"} queued for "${editingMedia.title}".` });
  };

  const handleUploadRelease = async (event) => {
    event.preventDefault();
    if (!releaseVersion.trim() || !releaseFile) {
      setMessage({ type: "error", text: "Enter a version and choose an Android APK." });
      return;
    }

    setUploadingRelease(true);
    setReleaseProgress(0);
    setMessage(null);
    try {
      const release = await uploadAndroidRelease({
        file: releaseFile,
        version: releaseVersion.trim(),
        onProgress: setReleaseProgress,
      });
      setMobileRelease(release);
      setReleaseFile(null);
      const input = document.getElementById("admin-android-release-file");
      if (input) input.value = "";
      setMessage({ type: "success", text: `Android ${release.version} is ready to download.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setUploadingRelease(false);
      setReleaseProgress(null);
    }
  };

  const handleDeleteRelease = async () => {
    if (!window.confirm("Remove the current Android app release? The download button will become unavailable.")) return;
    try {
      const res = await api("/api/mobile-release", { method: "DELETE" });
      if (!res.ok) throw new Error(await readApiError(res, "Release removal failed"));
      setMobileRelease({ available: false });
      setMessage({ type: "success", text: "Android release removed." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div className="premium-app-shell" style={styles.page}>
        <header className="app-header admin-vault-header" style={styles.header}>
          <div style={styles.headerBlock}>
            <div>
              <div className="admin-vault-title" style={styles.headerTitle}>Vault controls</div>
              <div className="admin-vault-note" style={styles.headerNote}>Categories, media, and app distribution</div>
            </div>
          </div>
          {/* <div style={styles.headerActions}>
            <ThemeToggle style={styles.button("secondary")} />
          </div> */}
        </header>

        <main className="app-main admin-vault-main" style={{ ...styles.main, ...(player?.currentMedia ? styles.mainWithPlayer : {}) }}>
          {message && (
            <div style={styles.notice(message.type)}>
              <span>{message.type === "error" ? "⚠️" : "✅"}</span>
              <span>{message.text}</span>
            </div>
          )}

          {activeBrowserTransfer && mediaModalCategoryId === null && editingMedia === null && (
            <BrowserTransferProgress transfer={activeBrowserTransfer} onOpenQueue={openUploadQueue} />
          )}

          <section className="hero-surface" style={styles.toolbar}>
            <div style={styles.toolbarCopy}>
              <div style={styles.toolbarLabel}>Selected category</div>
              <div style={styles.toolbarValue}>
                {selectedCategory ? (selectedCategory.path || selectedCategory.name) : "None selected"}
              </div>
              <div style={styles.toolbarMeta}>
                {selectedCategory
                  ? `Tier ${selectedCategory.min_access_tier}${selectedCategory.parent_id ? " · nested category" : " · root category"}`
                  : "Choose a row in the table to unlock add-media and add-child actions."}
              </div>
            </div>
            <div style={styles.actionRow}>
              <button type="button" style={styles.button("secondary")} onClick={openUploadQueue}>
                Upload queue{activeBrowserTransfer
                  ? ` · ${activeBrowserTransfer.progress === null ? "active" : `${activeBrowserTransfer.progress ?? 0}%`}`
                  : uploadQueueSummary.queued + uploadQueueSummary.processing > 0
                    ? ` (${uploadQueueSummary.queued + uploadQueueSummary.processing})`
                    : ""}
              </button>
              <button type="button" style={styles.button("secondary")} onClick={() => openCategoryModal("")}>
                Create Root
              </button>
              <button
                type="button"
                style={styles.button("secondary", !selectedCategory)}
                disabled={!selectedCategory}
                onClick={() => openCategoryModal(selectedCategory?.id)}
              >
                Create Child
              </button>
              <button
                type="button"
                style={styles.button("primary", !selectedCategory)}
                disabled={!selectedCategory}
                onClick={() => openMediaModal(selectedCategory.id)}
              >
                Upload Here
              </button>
            </div>
          </section>

          <section className="admin-release-card" aria-labelledby="admin-release-title">
            <header className="admin-release-header">
              <div className="admin-release-heading-icon" aria-hidden="true">
                <FontAwesomeIcon icon={faMobileScreenButton} />
              </div>
              <div>
                <span className="admin-release-eyebrow">App distribution</span>
                <h2 id="admin-release-title">Android release</h2>
                <p>Control the APK offered in the library sidebar and mobile Browse sheet.</p>
              </div>
            </header>

            <div className="admin-release-layout">
              <aside className={`admin-release-status${mobileRelease?.available ? " admin-release-status--published" : ""}`}>
                <div className="admin-release-status-topline">
                  <span className="admin-release-status-badge">
                    <span aria-hidden="true" />
                    {mobileRelease?.available ? "Published" : "Offline"}
                  </span>
                  <FontAwesomeIcon
                    icon={mobileRelease?.available ? faCircleCheck : faMobileScreenButton}
                    className="admin-release-status-icon"
                    aria-hidden="true"
                  />
                </div>

                <div className="admin-release-status-copy">
                  <span>Current download</span>
                  <h3>{mobileRelease?.available ? `Dogmedia ${mobileRelease.version}` : "No active build"}</h3>
                  <p>
                    {mobileRelease?.available
                      ? `${formatBytes(mobileRelease.size)} · Published ${new Date(mobileRelease.uploadedAt).toLocaleString()}`
                      : "Downloads stay hidden until an APK is published."}
                  </p>
                </div>

                {mobileRelease?.available && (
                  <div className="admin-release-status-actions">
                    <a href={apiUrl("/api/mobile-release/download")} download className="admin-release-action">
                      <FontAwesomeIcon icon={faDownload} />
                      Download
                    </a>
                    <button
                      type="button"
                      className="admin-release-action admin-release-action--danger"
                      disabled={uploadingRelease}
                      onClick={handleDeleteRelease}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                      Remove
                    </button>
                  </div>
                )}
              </aside>

              <form className="admin-release-publisher" onSubmit={handleUploadRelease}>
                <div className="admin-release-publisher-heading">
                  <div>
                    <span>Release manifest</span>
                    <h3>{mobileRelease?.available ? "Replace the current APK" : "Publish your first APK"}</h3>
                    <p>Identify the build, then attach the package people will download.</p>
                  </div>
                  <span className="admin-release-count">2 required fields</span>
                </div>

                <div className="admin-release-fields">
                  <div className="admin-release-step admin-release-version-field">
                    <div className="admin-release-step-heading">
                      <span className="admin-release-step-index">01</span>
                      <div>
                        <label htmlFor="admin-android-release-version">Version label</label>
                        <p>Shown beside the app download.</p>
                      </div>
                    </div>
                    <div className="admin-release-version-control">
                      <span aria-hidden="true">v</span>
                      <input
                        id="admin-android-release-version"
                        value={releaseVersion}
                        onChange={(event) => setReleaseVersion(event.target.value)}
                        placeholder="1.0.0"
                        autoComplete="off"
                        disabled={uploadingRelease}
                      />
                    </div>
                  </div>

                  <div className="admin-release-step admin-release-file-field">
                    <div className="admin-release-step-heading">
                      <span className="admin-release-step-index">02</span>
                      <div>
                        <span className="admin-release-field-label">Android package</span>
                        <p>Choose the signed APK to publish.</p>
                      </div>
                    </div>
                    <input
                      id="admin-android-release-file"
                      className="admin-release-file-input"
                      type="file"
                      accept=".apk,application/vnd.android.package-archive"
                      onChange={(event) => setReleaseFile(event.target.files[0] || null)}
                      disabled={uploadingRelease}
                    />
                    <label
                      htmlFor="admin-android-release-file"
                      className={`admin-release-file-picker${releaseFile ? " admin-release-file-picker--selected" : ""}${uploadingRelease ? " admin-release-file-picker--disabled" : ""}`}
                    >
                      <span className="admin-release-file-icon" aria-hidden="true">
                        <FontAwesomeIcon icon={releaseFile ? faFileShield : faCloudArrowUp} />
                      </span>
                      <span className="admin-release-file-copy">
                        <strong>{releaseFile ? releaseFile.name : "Choose an APK file"}</strong>
                        <small>{releaseFile ? `${formatBytes(releaseFile.size)} ready to upload` : "Signed or internal-release builds are accepted"}</small>
                      </span>
                      <span className="admin-release-file-cta">{releaseFile ? "Change" : "Browse"}</span>
                    </label>
                  </div>
                </div>

                {uploadingRelease && (
                  <div
                    className="admin-release-progress"
                    role="progressbar"
                    aria-label="Android release upload progress"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    aria-valuenow={releaseProgress ?? 0}
                  >
                    <span style={{ width: `${releaseProgress ?? 0}%` }} />
                  </div>
                )}

                <div className="admin-release-publisher-footer">
                  <div className="admin-release-specs" aria-label="Upload requirements">
                    <span><strong>APK</strong> format</span>
                    <span><strong>300 MB</strong> maximum</span>
                    <span><strong>512 KB</strong> chunks</span>
                  </div>
                  <button
                    type="submit"
                    className="admin-release-publish"
                    disabled={uploadingRelease || !releaseFile || !releaseVersion.trim()}
                  >
                    {uploadingRelease && <span style={styles.spinner} />}
                    {uploadingRelease
                      ? `Uploading ${releaseProgress ?? 0}%`
                      : mobileRelease?.available ? "Replace release" : "Publish release"}
                  </button>
                </div>
              </form>
            </div>
          </section>

          <section className="glass-surface" style={styles.tableCard}>
            <div style={styles.tableHeader}>
              <h2 style={styles.cardTitle}>Category Tree</h2>
              <p style={styles.cardSubtitle}>Drag folders between rows to reorder, onto a folder to nest, or into the root zone to unnest.</p>
            </div>

            {categories.length === 0 ? (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>🗂️</div>
                <div style={{ fontWeight: 700, color: "var(--text)" }}>No categories yet</div>
                <p style={{ marginTop: 6, marginBottom: 0 }}>
                  Create a root category first, then add children like Music / Evanescence.
                </p>
              </div>
            ) : (
              <div style={{ padding: 12 }}>
                <CategoryTreeDnd
                  categories={categories}
                  moving={movingCategory}
                  selectedId={selectedCategoryId}
                  onSelect={(id) => setSelectedCategoryId(String(id))}
                  onMove={handleMoveCategory}
                  onManageMedia={openMediaModal}
                  onAddChild={openCategoryModal}
                  onDelete={handleDeleteCategory}
                />
              </div>
            )}
          </section>
        </main>

        {categoryModalOpen && (
          <Modal
            title={categoryParentId ? "Add Child Category" : "Add Category"}
            subtitle={
              categoryParentId
                ? `Create a nested category beneath ${categories.find((category) => String(category.id) === String(categoryParentId))?.path || "the selected parent"}`
                : "Create a new root category for the tree."
            }
            width={720}
            onClose={closeCategoryModal}
          >
            <form onSubmit={handleCreateCategory}>
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Name</label>
                <input
                  style={styles.input}
                  value={newCategoryName}
                  onChange={(event) => setNewCategoryName(event.target.value)}
                  placeholder="Music"
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Description <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
                <textarea
                  style={styles.textarea}
                  value={newCategoryDescription}
                  onChange={(event) => setNewCategoryDescription(event.target.value)}
                  placeholder="A short description for this branch..."
                />
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Parent Category</label>
                <select
                  style={styles.select}
                  value={categoryParentId}
                  onChange={(event) => {
                    const nextParentId = event.target.value;
                    const parentCategory = nextParentId
                      ? categories.find((category) => String(category.id) === String(nextParentId))
                      : null;
                    setCategoryParentId(nextParentId);
                    setNewCategoryTier(parentCategory ? String(parentCategory.min_access_tier) : "0");
                  }}
                >
                  <option value="">No parent (root)</option>
                  {categoryRows.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.path || category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={styles.fieldGroup}>
                <label style={styles.label}>Minimum Access Tier</label>
                {categoryParentId ? (
                  <div
                    style={{
                      ...styles.input,
                      minHeight: 42,
                      display: "flex",
                      alignItems: "center",
                      background: "var(--card-bg)",
                      color: "var(--muted)",
                    }}
                  >
                    Tier {newCategoryTier}
                  </div>
                ) : (
                  <input
                    type="number"
                    min="0"
                    style={styles.input}
                    value={newCategoryTier}
                    onChange={(event) => setNewCategoryTier(event.target.value)}
                  />
                )}
                <p style={styles.helpText}>
                  {categoryParentId
                    ? "Child categories always inherit the minimum access tier from their parent."
                    : "Only users at this tier or higher can see the branch below this category."}
                </p>
              </div>

              <button type="submit" disabled={creatingCategory} style={styles.button("primary", creatingCategory)}>
                {creatingCategory && <span style={styles.spinner} />}
                {creatingCategory ? "Creating..." : "Create Category"}
              </button>
            </form>
          </Modal>
        )}

        {mediaModalCategoryId !== null && (
          <Modal
            title={activeMediaCategory ? (activeMediaCategory.path || activeMediaCategory.name) : "Selected Category"}
            subtitle="Manage existing media and upload directly into the selected category."
            width={1120}
            onClose={closeMediaModal}
          >
            {message && (
              <div
                role={message.type === "error" ? "alert" : "status"}
                style={{ ...styles.notice(message.type), marginBottom: 16 }}
              >
                <span>{message.type === "error" ? "⚠️" : "✅"}</span>
                <span>{message.text}</span>
              </div>
            )}

            <FolderArtworkEditor
              category={activeMediaCategory}
              file={categoryCoverFile}
              onFileChange={setCategoryCoverFile}
              onSubmit={handleUpdateCategoryCover}
              updating={updatingCategoryCover}
            />

            <div className="admin-media-tabs" role="tablist" aria-label="Media workspace">
              <button
                type="button"
                role="tab"
                aria-selected={mediaWorkspaceTab === "collection"}
                className={mediaWorkspaceTab === "collection" ? "admin-media-tab admin-media-tab--active" : "admin-media-tab"}
                onClick={() => setMediaWorkspaceTab("collection")}
              >
                <FontAwesomeIcon icon={faFolderOpen} />
                <span>Collection</span>
                <small>{categoryMedia.length} items</small>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mediaWorkspaceTab === "video"}
                className={mediaWorkspaceTab === "video" ? "admin-media-tab admin-media-tab--active" : "admin-media-tab"}
                onClick={() => setMediaWorkspaceTab("video")}
              >
                <FontAwesomeIcon icon={faFilm} />
                <span>Upload video</span>
                <small>Anime or film</small>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mediaWorkspaceTab === "album"}
                className={mediaWorkspaceTab === "album" ? "admin-media-tab admin-media-tab--active" : "admin-media-tab"}
                onClick={() => setMediaWorkspaceTab("album")}
              >
                <FontAwesomeIcon icon={faMusic} />
                <span>Import album</span>
                <small>Music and lyrics</small>
              </button>
            </div>

            {mediaWorkspaceTab === "collection" && (
              <section style={styles.panel}>
                <div style={styles.panelHeader}>
                  <h3 style={styles.cardTitle}>Collection</h3>
                  <p style={styles.cardSubtitle}>
                    {activeMediaCategory
                      ? `Stored in ${activeMediaCategory.path || activeMediaCategory.name}`
                      : "The selected category is no longer available."}
                  </p>
                </div>
                <div style={styles.panelBody}>
                  <div style={{ ...styles.actionRow, justifyContent: "space-between", marginBottom: 14 }}>
                    <p style={{ ...styles.helpText, margin: 0 }}>
                      Music uses embedded track numbers. Videos can be arranged manually after upload.
                    </p>
                    <div style={styles.actionRow}>
                      {categoryMedia.some((item) => item.mime_type?.startsWith("video/")) && !reorderingVideos && (
                        <button type="button" style={styles.button("secondary")} onClick={openVideoOrdering}>Order videos</button>
                      )}
                      <button
                        type="button"
                        disabled={scanningTrackOrders}
                        style={styles.button("secondary", scanningTrackOrders)}
                        onClick={handleScanTrackOrders}
                      >
                        {scanningTrackOrders && <span style={styles.spinner} />}
                        {scanningTrackOrders ? "Scanning..." : "Scan music order"}
                      </button>
                    </div>
                  </div>
                  {loadingMedia ? (
                    <div style={{ ...styles.emptyState, padding: "18px 8px" }}>
                      <span style={styles.spinner} />
                      <p style={{ marginTop: 10, marginBottom: 0 }}>Loading media...</p>
                    </div>
                  ) : categoryMedia.length === 0 ? (
                    <div style={{ ...styles.emptyState, padding: "18px 8px" }}>
                      <div style={styles.emptyIcon}>🎞️</div>
                      <div style={{ fontWeight: 700, color: "var(--text)" }}>No media in this category</div>
                      <p style={{ marginTop: 6, marginBottom: 0 }}>Choose Upload video or Import album to add the first item.</p>
                    </div>
                  ) : (
                    <div style={styles.mediaList}>
                      {categoryMedia.map((media) => (
                        <div key={media.id} className="admin-media-item" style={styles.mediaItem}>
                          {reorderingVideos && media.mime_type?.startsWith("video/") && (
                            <label className="admin-video-order-field">
                              <span>Order</span>
                              <input
                                type="number"
                                min="1"
                                value={videoOrderDraft[media.id] ?? ""}
                                onChange={(event) => setVideoOrderDraft((current) => ({ ...current, [media.id]: event.target.value }))}
                                aria-label={`Playback order for ${media.title}`}
                              />
                            </label>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <div style={styles.mediaTitle} title={media.title}>
                              {media.title}
                            </div>
                            <div style={styles.mediaMeta}>
                              {media.track_order != null ? `Track ${media.track_order} · ` : ""}
                              {media.artists?.trim() ? `${media.artists} · ` : ""}
                              {media.duration != null ? formatDuration(media.duration) : "Unknown duration"}
                              {" · "}
                              {media.mime_type || "Unknown type"}
                            </div>
                            <EncodingProgress status={media.encoding_status} />
                          </div>
                          <div className="admin-media-actions" style={styles.rowActions}>
                            {reorderingVideos && media.mime_type?.startsWith("video/") ? null : (
                              <>
                            <button
                              type="button"
                              style={styles.button("secondary")}
                              onClick={() => openEditMediaModal(media)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              style={styles.button("danger")}
                              onClick={() => handleDeleteMedia(media)}
                            >
                              Delete
                            </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {reorderingVideos && (
                    <div className="admin-order-actions">
                      <p>Use unique numbers. Lower numbers play first.</p>
                      <div style={styles.actionRow}>
                        <button type="button" disabled={savingVideoOrder} style={styles.button("secondary", savingVideoOrder)} onClick={() => setReorderingVideos(false)}>Cancel</button>
                        <button type="button" disabled={savingVideoOrder} style={styles.button("primary", savingVideoOrder)} onClick={handleSaveVideoOrder}>
                          {savingVideoOrder && <span style={styles.spinner} />}
                          {savingVideoOrder ? "Saving..." : "Save video order"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {mediaWorkspaceTab === "video" && (
              <section style={styles.panel}>
                <div style={styles.panelHeader}>
                  <h3 style={styles.cardTitle}>Upload anime or film</h3>
                  <p style={styles.cardSubtitle}>Choose the source first, then confirm the information viewers will see.</p>
                </div>
                <div style={styles.panelBody}>
                  <form onSubmit={handleUploadMedia}>
                    <div className="admin-import-destination">
                      <span>Upload destination</span>
                      <strong>{activeMediaCategory ? (activeMediaCategory.path || activeMediaCategory.name) : "No category selected"}</strong>
                    </div>

                    <div className="admin-import-step">
                      <div className="admin-import-step-heading">
                        <span>1</span>
                        <div>
                          <h4>Choose videos</h4>
                          <p>Select one film or many anime episodes. MP4, MKV, WebM, MOV, and AVI are accepted.</p>
                        </div>
                      </div>
                      <input
                        id="admin-media-file"
                        type="file"
                        multiple={videoKind !== "film"}
                        accept="video/*,.mkv,.avi"
                        onChange={(event) => {
                          setVideoFiles(Array.from(event.target.files || []));
                          setVideoOverrides({});
                        }}
                        style={styles.fileInput}
                      />
                      {videoItems.length > 0 && <p className="admin-selected-file">{videoItems.length} video selected · {formatBytes(videoItems.reduce((total, item) => total + item.file.size, 0))}</p>}
                    </div>

                    <div className="admin-import-step">
                      <div className="admin-import-step-heading">
                        <span>2</span>
                        <div>
                          <h4>Describe the batch</h4>
                          <p>The selected type and optional synopsis are applied to every video.</p>
                        </div>
                      </div>
                      <div className="admin-kind-options" role="radiogroup" aria-label="Video kind">
                        {[{ value: "episode", label: "Anime episode" }, { value: "film", label: "Film" }, { value: "other", label: "Other video" }].map((option) => (
                          <label key={option.value} className={videoKind === option.value ? "admin-kind-option admin-kind-option--active" : "admin-kind-option"}>
                            <input type="radio" name="video-kind" value={option.value} checked={videoKind === option.value} onChange={() => setVideoKind(option.value)} />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                      <div style={styles.fieldGroup}>
                        <label style={styles.label}>Shared synopsis <span className="admin-optional">(optional)</span></label>
                        <textarea style={styles.textarea} value={mediaDescription} onChange={(event) => setMediaDescription(event.target.value)} placeholder="A short description applied to every selected video..." />
                      </div>
                    </div>

                    {videoItems.length > 0 && (
                      <div className="admin-import-step">
                        <div className="admin-import-step-heading">
                          <span>3</span>
                          <div>
                            <h4>Review titles and initial order</h4>
                            <p>Episode numbers are read from names such as S01E03, Episode 03, or 03-title. You can reorder everything again after upload.</p>
                          </div>
                        </div>
                        <div className="admin-track-manifest">
                          <div className="admin-track-manifest-head"><span>Order</span><span>Title</span><span>File</span></div>
                          {videoItems.map((item) => (
                            <div key={item.key} className="admin-track-row">
                              <input aria-label={`Initial order for ${item.title}`} type="number" min="1" value={videoOverrides[item.key]?.trackOrder ?? item.trackOrder} onChange={(event) => setVideoOverrides((current) => ({ ...current, [item.key]: { ...current[item.key], trackOrder: event.target.value } }))} />
                              <input aria-label={`Title for ${item.title}`} value={videoOverrides[item.key]?.title ?? item.title} onChange={(event) => setVideoOverrides((current) => ({ ...current, [item.key]: { ...current[item.key], title: event.target.value } }))} />
                              <div className="admin-track-file" title={item.file.name}>
                                <strong>{getExt(item.file.name).toUpperCase()} · {formatBytes(item.file.size)}</strong>
                                <span>{item.file.name}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="admin-import-step">
                      <div className="admin-import-step-heading">
                        <span>4</span>
                        <div>
                          <h4>{videoKind === "film" ? "Add film artwork" : "Add shared artwork"}</h4>
                          <p>{videoKind === "film"
                            ? "Optional. This artwork is attached to the film itself, not the folder. A frame is extracted automatically when left empty."
                            : "The image is copied to every uploaded episode. A frame is extracted from each video when left empty."}</p>
                        </div>
                      </div>
                      <input id="admin-media-thumb" type="file" accept="image/*" onChange={(event) => setMediaThumb(event.target.files[0] || null)} style={styles.fileInput} />
                      {mediaThumb && <p className="admin-selected-file">Artwork selected · {mediaThumb.name}</p>}
                    </div>

                    <div className="admin-import-footer">
                      <div>
                        <strong>{videoItems.length} video{videoItems.length === 1 ? "" : "s"}</strong>
                        <span>{formatBytes(videoItems.reduce((total, item) => total + item.file.size, 0))} · {uploadingMedia
                          ? uploadProgress >= 100 ? "Transfer complete · follow the worker in Upload queue" : formatUploadRemaining(uploadEtaSeconds)
                          : "duration detected automatically"}</span>
                      </div>
                      <button type="submit" disabled={uploadingMedia || !activeMediaCategory || videoItems.length === 0 || videoHasInvalidRows || filmSelectionInvalid} style={styles.button("primary", uploadingMedia || !activeMediaCategory || videoItems.length === 0 || videoHasInvalidRows || filmSelectionInvalid)}>
                        {uploadingMedia && <span style={styles.spinner} />}
                        {uploadingMedia
                          ? uploadProgress >= 100 ? "Waiting for worker" : `Uploading ${uploadProgress ?? 0}%`
                          : `Upload ${videoItems.length} video${videoItems.length === 1 ? "" : "s"}`}
                      </button>
                    </div>
                  </form>
                </div>
              </section>
            )}

            {mediaWorkspaceTab === "album" && (
              <div className="admin-album-workspace">
                <section style={styles.panel}>
                  <div style={styles.panelHeader}>
                    <h3 style={styles.cardTitle}>Import a music album</h3>
                    <p style={styles.cardSubtitle}>Choose a folder or loose tracks, review the manifest, then import them together.</p>
                  </div>
                  <div style={styles.panelBody}>
                    <div className="admin-import-destination">
                      <span>Album destination</span>
                      <strong>{activeMediaCategory ? (activeMediaCategory.path || activeMediaCategory.name) : "No category selected"}</strong>
                    </div>
                  <form onSubmit={handleUploadBatch}>
                    <div className="admin-import-step">
                      <div className="admin-import-step-heading">
                        <span>1</span>
                        <div><h4>Choose the music</h4><p>A folder may include cover artwork and matching Whisper JSON lyrics.</p></div>
                      </div>
                      <div className="admin-source-options">
                        <input id="admin-media-batch-folder" className="admin-source-input" type="file" multiple webkitdirectory="" directory="" accept="audio/*,image/*,application/json,.flac,.wav,.m4a,.mp3,.ogg,.opus,.aac,.json" onChange={(event) => { setBatchFiles(Array.from(event.target.files || [])); setBatchOverrides({}); }} />
                        <label className="admin-source-option" htmlFor="admin-media-batch-folder">
                          <FontAwesomeIcon icon={faMusic} />
                          <strong>Choose album folder</strong>
                          <span>Best for a complete album</span>
                        </label>
                        <input id="admin-media-batch-files" className="admin-source-input" type="file" multiple accept="audio/*,image/*,application/json,.flac,.wav,.m4a,.mp3,.ogg,.opus,.aac,.json" onChange={(event) => { setBatchFiles(Array.from(event.target.files || [])); setBatchOverrides({}); }} />
                        <label className="admin-source-option" htmlFor="admin-media-batch-files">
                          <FontAwesomeIcon icon={faCloudArrowUp} />
                          <strong>Choose music files</strong>
                          <span>For one or more loose tracks</span>
                        </label>
                      </div>
                    </div>

                    <div className="admin-import-step">
                      <div className="admin-import-step-heading">
                        <span>2</span>
                        <div><h4>Set shared album details</h4><p>Leave the artist blank to read it from each audio file.</p></div>
                      </div>
                      <div style={styles.fieldGroup}>
                        <label style={styles.label}>Album artist <span className="admin-optional">(optional)</span></label>
                        <input style={styles.input} value={batchArtist} onChange={(event) => setBatchArtist(event.target.value)} placeholder="Use embedded artist metadata" />
                      </div>
                    </div>

                    {batchFiles.length > 0 && (
                      <div className="admin-import-step">
                        <div className="admin-import-step-heading">
                          <span>3</span>
                          <div><h4>Review the track manifest</h4><p>Correct titles or track numbers before the import starts.</p></div>
                        </div>
                        <div className="admin-batch-summary" style={styles.batchSummary}>
                          <div style={styles.batchSummaryItem}>
                            <div style={styles.batchSummaryLabel}>Tracks</div>
                            <div style={styles.batchSummaryValue}>{batchSummary.tracks}</div>
                          </div>
                          <div style={styles.batchSummaryItem}>
                            <div style={styles.batchSummaryLabel}>Covers / lyrics</div>
                            <div style={styles.batchSummaryValue}>{batchSummary.covers}/{batchSummary.lyrics}</div>
                          </div>
                          <div style={styles.batchSummaryItem}>
                            <div style={styles.batchSummaryLabel}>Audio size</div>
                            <div style={styles.batchSummaryValue}>{formatBytes(batchSummary.bytes)}</div>
                          </div>
                        </div>
                        <p style={styles.helpText}>
                          Selected {batchSummary.files} file{batchSummary.files === 1 ? "" : "s"}.
                          {batchSummary.skipped ? ` ${batchSummary.skipped} duplicate format candidate${batchSummary.skipped === 1 ? "" : "s"} will be ignored.` : ""}
                        </p>
                        {batchItems.length === 0 ? (
                          <p style={styles.helpText}>No audio files found in that selection.</p>
                        ) : (
                          <div className="admin-track-manifest">
                            <div className="admin-track-manifest-head"><span>No.</span><span>Title</span><span>File</span></div>
                            {batchItems.map((item) => (
                              <div key={item.key} className="admin-track-row">
                                <input aria-label={`Track number for ${item.title}`} type="number" min="1" value={batchOverrides[item.key]?.trackOrder ?? item.trackOrder ?? ""} onChange={(event) => setBatchOverrides((current) => ({ ...current, [item.key]: { ...current[item.key], trackOrder: event.target.value } }))} placeholder="—" />
                                <input aria-label={`Title for ${item.title}`} value={batchOverrides[item.key]?.title ?? item.title} onChange={(event) => setBatchOverrides((current) => ({ ...current, [item.key]: { ...current[item.key], title: event.target.value } }))} />
                                <div className="admin-track-file" title={item.file.webkitRelativePath || item.file.name}>
                                  <strong>{getExt(item.file.name).toUpperCase()} · {formatBytes(item.file.size)}</strong>
                                  <span>{item.lyrics ? "Lyrics matched" : "No lyrics"}{item.skippedCount ? ` · ${item.skippedCount} duplicate ignored` : ""}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="admin-import-footer">
                      <div><strong>{batchItems.length} track{batchItems.length === 1 ? "" : "s"}</strong><span>{formatBytes(batchSummary.bytes)} · {uploadingBatch
                        ? batchProgress >= 100 ? "Transfer complete · follow the worker in Upload queue" : formatUploadRemaining(batchEtaSeconds)
                        : "ready to import"}</span></div>
                      <button type="submit" disabled={uploadingBatch || !activeMediaCategory || batchItems.length === 0 || batchHasInvalidRows} style={styles.button("primary", uploadingBatch || !activeMediaCategory || batchItems.length === 0 || batchHasInvalidRows)}>
                        {uploadingBatch && <span style={styles.spinner} />}
                        {uploadingBatch
                          ? batchProgress >= 100 ? "Waiting for worker" : `Importing ${batchProgress ?? 0}%`
                          : `Import ${batchItems.length} track${batchItems.length === 1 ? "" : "s"}`}
                      </button>
                    </div>
                  </form>
                </div>
              </section>

              </div>
            )}
          </Modal>
        )}

        {editingMedia && (
          <Modal
            title={`Edit ${editingMedia.title}`}
            subtitle="Update metadata, artwork, source files, and encoding."
            width={820}
            onClose={savingEdit ? () => {} : closeEditMediaModal}
          >
            <form onSubmit={handleSaveMediaEdit}>
              <div className="admin-modal-grid" style={styles.modalGrid}>
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
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        placeholder="Media title"
                      />
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>Artists</label>
                      <input
                        style={styles.input}
                        value={editArtists}
                        onChange={(event) => setEditArtists(event.target.value)}
                        placeholder="Unknown Artist"
                      />
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>Track Order</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        style={styles.input}
                        value={editTrackOrder}
                        onChange={(event) => setEditTrackOrder(event.target.value)}
                        placeholder="No stored track order"
                      />
                      <p style={styles.helpText}>Leave blank to clear the stored track order.</p>
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>Description</label>
                      <textarea
                        style={styles.textarea}
                        value={editDescription}
                        onChange={(event) => setEditDescription(event.target.value)}
                        placeholder="A short description..."
                      />
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>Duration <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(seconds)</span></label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        style={styles.input}
                        value={editDuration}
                        onChange={(event) => setEditDuration(event.target.value)}
                        placeholder="180"
                      />
                      <p style={styles.helpText}>Leave blank to clear the stored duration; replacing the file can detect it again.</p>
                    </div>

                    {editingMedia.mime_type?.startsWith("audio/") && (
                      <label className="admin-protection-option">
                        <input
                          type="checkbox"
                          checked={editOfflineAllowed}
                          onChange={(event) => setEditOfflineAllowed(event.target.checked)}
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
                        {editingMedia.mime_type || "Unknown type"} · {editingMedia.duration != null ? formatDuration(editingMedia.duration) : "unknown duration"}
                      </div>
                      <EncodingProgress detailed status={editingMedia.encoding_status} />
                      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {Object.values(editingMedia.encoding_status || {}).some((item) => item.status === "failed") && (
                          <button type="button" style={styles.button("secondary", false)} onClick={() => handleRetryEncoding()}>Retry failed</button>
                        )}
                        {editingMedia.mime_type?.startsWith("video/") && (
                          <button type="button" style={styles.button("secondary", false)} onClick={() => handleRetryEncoding({ force: true })}>Re-encode video</button>
                        )}
                      </div>
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>Replace media file</label>
                      <input
                        id="admin-edit-media-file"
                        type="file"
                        accept="video/*,audio/*,image/*"
                        onChange={(event) => setEditFile(event.target.files[0] || null)}
                        style={styles.fileInput}
                      />
                      <p style={styles.helpText}>Large files upload in chunks. If you replace this, the old media file is removed.</p>
                    </div>

                    {(editingMedia.mime_type?.startsWith("video/") || editingMedia.mime_type?.startsWith("image/")) && (
                      <div style={styles.fieldGroup}>
                        <label style={styles.label}>Replace artwork</label>
                        <div className="admin-edit-artwork-row">
                          <img
                            className="admin-edit-artwork-preview"
                            src={editArtworkPreview}
                            alt={`${editArtwork ? "Selected" : "Current"} artwork for ${editingMedia.title}`}
                          />
                          <div className="admin-edit-artwork-control">
                            <input
                              id="admin-edit-media-artwork"
                              type="file"
                              accept="image/*"
                              onChange={(event) => setEditArtwork(event.target.files[0] || null)}
                              style={styles.fileInput}
                            />
                            {editArtwork && (
                              <button
                                type="button"
                                className="admin-edit-artwork-reset"
                                onClick={() => {
                                  setEditArtwork(null);
                                  const input = document.getElementById("admin-edit-media-artwork");
                                  if (input) input.value = "";
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
                        onChange={(event) => setEditLyrics(event.target.files[0] || null)}
                        style={styles.fileInput}
                      />
                      <p style={styles.helpText}>Use Whisper JSON. Existing lyrics stay unchanged unless you choose a new file.</p>
                    </div>
                  </div>
                </section>
              </div>

              <div style={{ ...styles.actionRow, justifyContent: "space-between", marginTop: 16 }}>
                <button type="button" style={styles.button("secondary", savingEdit)} disabled={savingEdit} onClick={closeEditMediaModal}>
                  Cancel
                </button>
                <button type="submit" disabled={savingEdit} style={styles.button("primary", savingEdit)}>
                  {savingEdit && <span style={styles.spinner} />}
                  {savingEdit
                    ? `Saving${editProgress === null ? "..." : ` ${editProgress}%`}`
                    : "Save Changes"}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {uploadQueueOpen && (
          <Modal
            title="Upload worker queue"
            subtitle="Monitor files waiting for or currently handled by the background worker."
            width={860}
            onClose={() => setUploadQueueOpen(false)}
          >
            <UploadQueuePanel
              browserTransfer={activeBrowserTransfer}
              error={uploadQueueError}
              jobs={uploadQueueJobs}
              loading={uploadQueueLoading}
              onRefresh={() => refreshUploadQueue()}
              summary={uploadQueueSummary}
            />
          </Modal>
        )}
      </div>
    </>
  );
}
