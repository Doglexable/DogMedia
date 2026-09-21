import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCloudArrowUp } from "@fortawesome/free-solid-svg-icons/faCloudArrowUp";

function formatQueueAge(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "just now";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function BrowserTransferProgress({ compact = false, onOpenQueue, transfer }) {
  if (!transfer) return null;
  const numericProgress = Number(transfer.progress);
  const progress = transfer.progress !== null && transfer.progress !== undefined && Number.isFinite(numericProgress)
    ? Math.min(100, Math.max(0, Math.round(numericProgress)))
    : null;

  return (
    <article className={`admin-browser-transfer${compact ? " admin-browser-transfer--compact" : ""}`} role="status" aria-live="polite">
      <div className="admin-browser-transfer-icon" aria-hidden="true"><FontAwesomeIcon icon={faCloudArrowUp} /></div>
      <div className="admin-browser-transfer-main">
        <div className="admin-browser-transfer-heading">
          <div><span>Browser transfer</span><strong>{transfer.title}</strong></div>
          <b>{progress === null ? "Working" : `${progress}%`}</b>
        </div>
        <div className={`admin-browser-transfer-track${progress === null ? " admin-browser-transfer-track--indeterminate" : ""}`} role="progressbar" aria-label={transfer.title} aria-valuemin="0" aria-valuemax="100" {...(progress === null ? {} : { "aria-valuenow": progress })}>
          <span style={progress === null ? undefined : { width: `${progress}%` }} />
        </div>
        <p>{transfer.detail} Do not refresh or close this tab.</p>
      </div>
      {!compact && onOpenQueue && <button type="button" onClick={onOpenQueue}>View queue</button>}
    </article>
  );
}

export default function UploadQueueViewer({ browserTransfer, error, jobs, loading, onRefresh, summary }) {
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
