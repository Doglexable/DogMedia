import { useEffect, useState } from "react";
import { api, categoryThumbnailUrl } from "../../api";
import { estimateUploadRemaining } from "../../pages/admin-import-utils";

const FALLBACK_CHUNK_SIZE = 4 * 1024 * 1024;

async function readApiError(response, fallback) {
  const text = await response.text().catch(() => "");
  if (!text) return fallback;
  try {
    return JSON.parse(text).error || fallback;
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

export async function uploadCategoryCover(categoryId, file) {
  const form = new FormData();
  form.append("thumbnail", file, file.name);
  const response = await api(`/api/categories/${categoryId}/thumbnail`, { method: "PUT", body: form });
  if (!response.ok) throw new Error(await readApiError(response, "Category cover upload failed"));
  return response.json();
}

export async function removeCategoryCover(categoryId) {
  const response = await api(`/api/categories/${categoryId}/thumbnail`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readApiError(response, "Category cover removal failed"));
}

async function sendFileChunks({ uploadId, file, kind, chunkSize, onProgress, startedAt, uploadedBytes, totalBytes }) {
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
  let sentBytes = uploadedBytes;

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
    const form = new FormData();
    form.append("kind", kind);
    form.append("index", String(index));
    form.append("chunk", chunk, file.name);

    const response = await api(`/api/media/uploads/${uploadId}/chunks`, { method: "POST", body: form });
    if (!response.ok) throw new Error(await readApiError(response, `Chunk upload failed (${response.status})`));

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

export async function uploadMediaInChunks({ categoryId, title, description = "", artists = "", trackOrder = "", duration = "", contentKind = "", file, lyricsFile = null, thumbnail = null, onProgress, onWorkerQueued }) {
  const lyrics = await readLyricsFile(lyricsFile);
  const initResponse = await api("/api/media/uploads", {
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
  if (!initResponse.ok) throw new Error(await readApiError(initResponse, `Upload setup failed (${initResponse.status})`));

  const { uploadId, chunkSize = FALLBACK_CHUNK_SIZE } = await initResponse.json();
  const totalBytes = Math.max(1, file.size + (thumbnail?.size || 0));
  let uploadedBytes = 0;
  let queuedForWorker = false;
  const startedAt = performance.now();

  try {
    uploadedBytes = await sendFileChunks({ uploadId, file, kind: "file", chunkSize, onProgress, startedAt, uploadedBytes, totalBytes });
    if (thumbnail) {
      await sendFileChunks({ uploadId, file: thumbnail, kind: "thumbnail", chunkSize, onProgress, startedAt, uploadedBytes, totalBytes });
    }
    const completeResponse = await api(`/api/media/uploads/${uploadId}/complete`, { method: "POST" });
    if (!completeResponse.ok) throw new Error(await readApiError(completeResponse, `Upload finalization failed (${completeResponse.status})`));
    const result = await completeResponse.json();
    if (completeResponse.status === 202) {
      queuedForWorker = true;
      onWorkerQueued?.(uploadId);
      return { uploadId, queued: true, status: result.status || "queued" };
    }
    return { uploadId, queued: false, media: result, status: "completed" };
  } catch (error) {
    if (!queuedForWorker) await api(`/api/media/uploads/${uploadId}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

export async function replaceMediaFilesInChunks({ mediaId, file = null, lyricsFile = null, thumbnail = null, onProgress, onWorkerQueued }) {
  const lyrics = lyricsFile ? await readLyricsFile(lyricsFile) : null;
  const initResponse = await api("/api/media/uploads", {
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
  if (!initResponse.ok) throw new Error(await readApiError(initResponse, `Replacement setup failed (${initResponse.status})`));

  const { uploadId, chunkSize = FALLBACK_CHUNK_SIZE } = await initResponse.json();
  const totalBytes = Math.max(1, (file?.size || 0) + (thumbnail?.size || 0));
  let uploadedBytes = 0;
  let queuedForWorker = false;
  const startedAt = performance.now();

  try {
    if (file) {
      uploadedBytes = await sendFileChunks({ uploadId, file, kind: "file", chunkSize, onProgress, startedAt, uploadedBytes, totalBytes });
    }
    if (thumbnail) {
      await sendFileChunks({ uploadId, file: thumbnail, kind: "thumbnail", chunkSize, onProgress, startedAt, uploadedBytes, totalBytes });
    }
    const completeResponse = await api(`/api/media/uploads/${uploadId}/complete`, { method: "POST" });
    if (!completeResponse.ok) throw new Error(await readApiError(completeResponse, `Replacement finalization failed (${completeResponse.status})`));
    const result = await completeResponse.json();
    if (completeResponse.status === 202) {
      queuedForWorker = true;
      onWorkerQueued?.(uploadId);
      return { uploadId, queued: true, status: result.status || "queued" };
    }
    return { uploadId, queued: false, media: result, status: "completed" };
  } catch (error) {
    if (!queuedForWorker) await api(`/api/media/uploads/${uploadId}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

export default function MediaUploadWorkspace({ category, file, onFileChange, onRemove, onSubmit, removing, styles, updating }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const currentUrl = category?.cover_path ? categoryThumbnailUrl(category) : "";

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
          <img key={previewUrl} className={file ? "admin-folder-artwork-image admin-folder-artwork-image--selected" : "admin-folder-artwork-image"} src={previewUrl} alt={`Folder artwork for ${categoryName}`} onError={() => setPreviewFailed(true)} />
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
        <input id="admin-category-cover-file" className="admin-folder-artwork-input" type="file" accept="image/*" onChange={(event) => onFileChange(event.target.files[0] || null)} />
        <div className="admin-folder-artwork-actions">
          {category?.cover_path && (
            <button
              type="button"
              className="admin-folder-artwork-remove"
              disabled={updating || removing}
              onClick={onRemove}
            >
              {removing ? "Removing..." : "Remove artwork"}
            </button>
          )}
          <button type="submit" disabled={updating || removing || !file || !category} style={styles.button("secondary", updating || removing || !file || !category)}>
            {updating && <span style={styles.spinner} />}
            {updating ? "Updating..." : "Save artwork"}
          </button>
        </div>
      </form>
    </section>
  );
}
