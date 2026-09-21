import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleCheck } from "@fortawesome/free-solid-svg-icons/faCircleCheck";
import { faCloudArrowUp } from "@fortawesome/free-solid-svg-icons/faCloudArrowUp";
import { faDownload } from "@fortawesome/free-solid-svg-icons/faDownload";
import { faFileShield } from "@fortawesome/free-solid-svg-icons/faFileShield";
import { faMobileScreenButton } from "@fortawesome/free-solid-svg-icons/faMobileScreenButton";
import { faTrash } from "@fortawesome/free-solid-svg-icons/faTrash";
import { api, apiUrl } from "../../api";

const FALLBACK_CHUNK_SIZE = 4 * 1024 * 1024;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

async function readApiError(response, fallback) {
  const text = await response.text().catch(() => "");
  if (!text) return fallback;
  try {
    return JSON.parse(text).error || fallback;
  } catch {
    return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || fallback;
  }
}

export async function uploadAndroidRelease({ file, version, onProgress }) {
  const initResponse = await api("/api/mobile-release/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, filename: file.name, size: file.size }),
  });
  if (!initResponse.ok) throw new Error(await readApiError(initResponse, `Release upload setup failed (${initResponse.status})`));

  const { uploadId, chunkSize = FALLBACK_CHUNK_SIZE } = await initResponse.json();
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * chunkSize;
      const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
      const form = new FormData();
      form.append("index", String(index));
      form.append("chunk", chunk, file.name);
      const chunkResponse = await api(`/api/mobile-release/uploads/${uploadId}/chunks`, { method: "POST", body: form });
      if (!chunkResponse.ok) throw new Error(await readApiError(chunkResponse, `APK chunk upload failed (${chunkResponse.status})`));
      onProgress?.(Math.round(((index + 1) / totalChunks) * 100));
    }
    const completeResponse = await api(`/api/mobile-release/uploads/${uploadId}/complete`, { method: "POST" });
    if (!completeResponse.ok) throw new Error(await readApiError(completeResponse, `Release finalization failed (${completeResponse.status})`));
    return completeResponse.json();
  } catch (error) {
    await api(`/api/mobile-release/uploads/${uploadId}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

export default function MobileReleaseManager({
  mobileRelease,
  onDelete,
  onFileChange,
  onSubmit,
  onVersionChange,
  releaseFile,
  releaseProgress,
  releaseVersion,
  styles,
  uploading,
}) {
  return (
    <section className="admin-release-card" aria-labelledby="admin-release-title">
      <header className="admin-release-header">
        <div className="admin-release-heading-icon" aria-hidden="true"><FontAwesomeIcon icon={faMobileScreenButton} /></div>
        <div>
          <span className="admin-release-eyebrow">App distribution</span>
          <h2 id="admin-release-title">Android release</h2>
          <p>Control the APK offered in the library sidebar and mobile Browse sheet.</p>
        </div>
      </header>
      <div className="admin-release-layout">
        <aside className={`admin-release-status${mobileRelease?.available ? " admin-release-status--published" : ""}`}>
          <div className="admin-release-status-topline">
            <span className="admin-release-status-badge"><span aria-hidden="true" />{mobileRelease?.available ? "Published" : "Offline"}</span>
            <FontAwesomeIcon icon={mobileRelease?.available ? faCircleCheck : faMobileScreenButton} className="admin-release-status-icon" aria-hidden="true" />
          </div>
          <div className="admin-release-status-copy">
            <span>Current download</span>
            <h3>{mobileRelease?.available ? `Dogmedia ${mobileRelease.version}` : "No active build"}</h3>
            <p>{mobileRelease?.available ? `${formatBytes(mobileRelease.size)} · Published ${new Date(mobileRelease.uploadedAt).toLocaleString()}` : "Downloads stay hidden until an APK is published."}</p>
          </div>
          {mobileRelease?.available && (
            <div className="admin-release-status-actions">
              <a href={apiUrl("/api/mobile-release/download")} download className="admin-release-action"><FontAwesomeIcon icon={faDownload} />Download</a>
              <button type="button" className="admin-release-action admin-release-action--danger" disabled={uploading} onClick={onDelete}><FontAwesomeIcon icon={faTrash} />Remove</button>
            </div>
          )}
        </aside>
        <form className="admin-release-publisher" onSubmit={onSubmit}>
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
                <div><label htmlFor="admin-android-release-version">Version label</label><p>Shown beside the app download.</p></div>
              </div>
              <div className="admin-release-version-control">
                <span aria-hidden="true">v</span>
                <input id="admin-android-release-version" value={releaseVersion} onChange={(event) => onVersionChange(event.target.value)} placeholder="1.0.0" autoComplete="off" disabled={uploading} />
              </div>
            </div>
            <div className="admin-release-step admin-release-file-field">
              <div className="admin-release-step-heading">
                <span className="admin-release-step-index">02</span>
                <div><span className="admin-release-field-label">Android package</span><p>Choose the signed APK to publish.</p></div>
              </div>
              <input id="admin-android-release-file" className="admin-release-file-input" type="file" accept=".apk,application/vnd.android.package-archive" onChange={(event) => onFileChange(event.target.files[0] || null)} disabled={uploading} />
              <label htmlFor="admin-android-release-file" className={`admin-release-file-picker${releaseFile ? " admin-release-file-picker--selected" : ""}${uploading ? " admin-release-file-picker--disabled" : ""}`}>
                <span className="admin-release-file-icon" aria-hidden="true"><FontAwesomeIcon icon={releaseFile ? faFileShield : faCloudArrowUp} /></span>
                <span className="admin-release-file-copy"><strong>{releaseFile ? releaseFile.name : "Choose an APK file"}</strong><small>{releaseFile ? `${formatBytes(releaseFile.size)} ready to upload` : "Signed or internal-release builds are accepted"}</small></span>
                <span className="admin-release-file-cta">{releaseFile ? "Change" : "Browse"}</span>
              </label>
            </div>
          </div>
          {uploading && (
            <div className="admin-release-progress" role="progressbar" aria-label="Android release upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={releaseProgress ?? 0}>
              <span style={{ width: `${releaseProgress ?? 0}%` }} />
            </div>
          )}
          <div className="admin-release-publisher-footer">
            <div className="admin-release-specs" aria-label="Upload requirements"><span><strong>APK</strong> format</span><span><strong>300 MB</strong> maximum</span><span><strong>512 KB</strong> chunks</span></div>
            <button type="submit" className="admin-release-publish" disabled={uploading || !releaseFile || !releaseVersion.trim()}>
              {uploading && <span style={styles.spinner} />}
              {uploading ? `Uploading ${releaseProgress ?? 0}%` : mobileRelease?.available ? "Replace release" : "Publish release"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
