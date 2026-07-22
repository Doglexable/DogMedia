import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { ThemeToggle, useAccess } from "../App";
import { api } from "../api";
import { useLibrary } from "../components/library-shell";
import { CategoryTreeDnd } from "../components/admin/category-tree-dnd";

const FALLBACK_CHUNK_SIZE = 512 * 1024;

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
    gridTemplateColumns: "1.05fr 0.95fr",
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

function orderCategories(categories) {
  return [...categories].sort((a, b) =>
    Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
    a.name.localeCompare(b.name) ||
    Number(a.id) - Number(b.id)
  );
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
    <div className="premium-modal-overlay" style={styles.modalOverlay} onClick={onClose}>
      <div
        className="premium-modal"
        style={{ ...styles.modal, maxWidth: width }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={styles.modalHeader}>
          <div>
            <h2 style={styles.modalTitle}>{title}</h2>
            {subtitle && <p style={styles.modalSubtitle}>{subtitle}</p>}
          </div>
          <button type="button" style={styles.modalClose} onClick={onClose}>
            Close
          </button>
        </div>
        <div style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

function clearFileInputs() {
  const mediaInput = document.getElementById("admin-media-file");
  const thumbInput = document.getElementById("admin-media-thumb");
  const lyricsInput = document.getElementById("admin-media-lyrics");
  const batchFolderInput = document.getElementById("admin-media-batch-folder");
  const batchFilesInput = document.getElementById("admin-media-batch-files");
  if (mediaInput) mediaInput.value = "";
  if (thumbInput) thumbInput.value = "";
  if (lyricsInput) lyricsInput.value = "";
  if (batchFolderInput) batchFolderInput.value = "";
  if (batchFilesInput) batchFilesInput.value = "";
}

const AUDIO_IMPORT_PRIORITY = ["flac", "wav", "m4a", "mp3", "ogg", "opus", "aac"];
const COVER_BASENAMES = new Set(["cover", "front-cover", "front_cover", "front", "folder", "albumart", "album-art"]);

function getExt(fileName) {
  const parts = String(fileName || "").split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function getStem(fileName) {
  const name = String(fileName || "").split("/").pop();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function getRelativeDir(file) {
  const relativePath = file.webkitRelativePath || file.name;
  const lastSlash = relativePath.lastIndexOf("/");
  return lastSlash > -1 ? relativePath.slice(0, lastSlash) : "";
}

function titleFromStem(stem) {
  return stem
    .replace(/^[\d\s._-]+/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || stem;
}

function isAudioImportFile(file) {
  return file.type.startsWith("audio/") || AUDIO_IMPORT_PRIORITY.includes(getExt(file.name));
}

function isCoverFile(file) {
  return file.type.startsWith("image/") && COVER_BASENAMES.has(getStem(file.name).toLowerCase());
}

function isLyricsFile(file) {
  return getExt(file.name) === "json";
}

function buildBatchItems(files) {
  const folders = new Map();

  for (const file of files) {
    const folderName = getRelativeDir(file);
    if (!folders.has(folderName)) {
      folders.set(folderName, { cover: null, lyrics: new Map(), tracks: new Map() });
    }

    const folder = folders.get(folderName);
    if (isCoverFile(file)) {
      folder.cover = folder.cover || file;
      continue;
    }

    if (isLyricsFile(file)) {
      folder.lyrics.set(getStem(file.name), file);
      continue;
    }

    if (!isAudioImportFile(file)) continue;

    const stem = getStem(file.name);
    if (!folder.tracks.has(stem)) {
      folder.tracks.set(stem, []);
    }
    folder.tracks.get(stem).push(file);
  }

  const items = [];
  for (const [folderName, folder] of folders) {
    for (const [stem, candidates] of folder.tracks) {
      const sorted = [...candidates].sort((a, b) => {
        const aRank = AUDIO_IMPORT_PRIORITY.indexOf(getExt(a.name));
        const bRank = AUDIO_IMPORT_PRIORITY.indexOf(getExt(b.name));
        return (aRank === -1 ? 999 : aRank) - (bRank === -1 ? 999 : bRank);
      });
      const file = sorted[0];
      items.push({
        key: `${folderName}/${stem}`,
        title: titleFromStem(stem),
        file,
        lyrics: folder.lyrics.get(stem) || null,
        thumbnail: folder.cover,
        folderName,
        skippedCount: Math.max(0, sorted.length - 1),
      });
    }
  }

  return items.sort((a, b) => a.key.localeCompare(b.key));
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

async function sendFileChunks({ uploadId, file, kind, chunkSize, onProgress, uploadedBytes, totalBytes }) {
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
    onProgress?.(Math.min(100, Math.round((sentBytes / totalBytes) * 100)));
  }

  return sentBytes;
}

async function uploadMediaInChunks({ categoryId, title, description = "", artists = "", duration = "", file, lyricsFile = null, thumbnail = null, onProgress }) {
  const lyrics = await readLyricsFile(lyricsFile);
  const initRes = await api("/api/media/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category_id: categoryId,
      title,
      description,
      artists,
      duration,
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

  try {
    uploadedBytes = await sendFileChunks({
      uploadId,
      file,
      kind: "file",
      chunkSize,
      onProgress,
      uploadedBytes,
      totalBytes,
    });

    if (thumbnail) {
      uploadedBytes = await sendFileChunks({
        uploadId,
        file: thumbnail,
        kind: "thumbnail",
        chunkSize,
        onProgress,
        uploadedBytes,
        totalBytes,
      });
    }

    const completeRes = await api(`/api/media/uploads/${uploadId}/complete`, { method: "POST" });
    if (!completeRes.ok) {
      throw new Error(await readApiError(completeRes, `Upload finalization failed (${completeRes.status})`));
    }

    onProgress?.(100);
    return completeRes.json();
  } catch (error) {
    await api(`/api/media/uploads/${uploadId}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

export default function Admin() {
  const { tier } = useAccess();
  const { refreshCategories: refreshGlobalCategories } = useLibrary();
  const [categories, setCategories] = useState([]);
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
  const [categoryMedia, setCategoryMedia] = useState([]);
  const [mediaTitle, setMediaTitle] = useState("");
  const [mediaDescription, setMediaDescription] = useState("");
  const [mediaArtists, setMediaArtists] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaThumb, setMediaThumb] = useState(null);
  const [mediaLyrics, setMediaLyrics] = useState(null);
  const [mediaDuration, setMediaDuration] = useState("");
  const [batchFiles, setBatchFiles] = useState([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [uploadingBatch, setUploadingBatch] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [batchProgress, setBatchProgress] = useState(null);
  const [loadingMedia, setLoadingMedia] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadCategories = async () => {
      try {
        const res = await api("/api/categories");
        const data = await res.json();
        if (!cancelled) {
          setCategories(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) {
          setMessage({ type: "error", text: "Failed to load categories." });
        }
      }
    };

    loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!categoryModalOpen && mediaModalCategoryId === null) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [categoryModalOpen, mediaModalCategoryId]);

  useEffect(() => {
    if (mediaModalCategoryId === null) return;

    let cancelled = false;
    const loadMedia = async () => {
      setLoadingMedia(true);
      try {
        const res = await api(`/api/media?category_id=${mediaModalCategoryId}`);
        const data = await res.json();
        if (!cancelled) {
          setCategoryMedia(Array.isArray(data) ? data : []);
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
    setCategoryMedia([]);
    setMediaTitle("");
    setMediaDescription("");
    setMediaArtists("");
    setMediaFile(null);
    setMediaThumb(null);
    setMediaLyrics(null);
    setMediaDuration("");
    setBatchFiles([]);
    clearFileInputs();
    setSelectedCategoryId(String(categoryId));
  };

  const closeMediaModal = () => {
    setMediaModalCategoryId(null);
    setCategoryMedia([]);
    setLoadingMedia(false);
    setMediaTitle("");
    setMediaDescription("");
    setMediaArtists("");
    setMediaFile(null);
    setMediaThumb(null);
    setMediaLyrics(null);
    setMediaDuration("");
    setBatchFiles([]);
    setUploadingBatch(false);
    clearFileInputs();
  };

  const refreshCategories = async () => {
    const res = await api("/api/categories");
    const data = await res.json();
    setCategories(Array.isArray(data) ? data : []);
    await refreshGlobalCategories();
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

    if (!mediaModalCategoryId || !mediaTitle.trim() || !mediaFile) {
      setMessage({ type: "error", text: "Category, title, and file are required." });
      return;
    }

    if (mediaDuration) {
      const parsedDuration = Number.parseFloat(mediaDuration);
      if (!Number.isFinite(parsedDuration) || parsedDuration < 0) {
        setMessage({ type: "error", text: "Duration must be a valid non-negative number." });
        return;
      }
    }

    setUploadingMedia(true);
    setUploadProgress(0);
    setMessage(null);

    try {
      const created = await uploadMediaInChunks({
        categoryId: mediaModalCategoryId,
        title: mediaTitle.trim(),
        description: mediaDescription,
        artists: mediaArtists,
        duration: mediaDuration ? String(Math.floor(Number.parseFloat(mediaDuration))) : "",
        file: mediaFile,
        lyricsFile: mediaLyrics,
        thumbnail: mediaThumb,
        onProgress: setUploadProgress,
      });
      setCategoryMedia((prev) => [...prev, created]);
      setMediaTitle("");
      setMediaDescription("");
      setMediaArtists("");
      setMediaFile(null);
      setMediaThumb(null);
      setMediaLyrics(null);
      setMediaDuration("");
      clearFileInputs();
      setMessage({ type: "success", text: `"${created.title}" uploaded successfully.` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setUploadingMedia(false);
      setUploadProgress(null);
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
    setMessage(null);

    const createdItems = [];
    const failures = [];

    for (const [itemIndex, item] of batchItems.entries()) {
      try {
        const created = await uploadMediaInChunks({
          categoryId: mediaModalCategoryId,
          title: item.title,
          file: item.file,
          lyricsFile: item.lyrics,
          thumbnail: item.thumbnail,
          onProgress: (progress) => {
            setBatchProgress(Math.round(((itemIndex + progress / 100) / batchItems.length) * 100));
          },
        });
        createdItems.push(created);
      } catch (error) {
        failures.push(`${item.title}: ${error.message}`);
      }
    }

    if (createdItems.length > 0) {
      setCategoryMedia((prev) => [...prev, ...createdItems]);
    }

    if (failures.length === 0) {
      setBatchFiles([]);
      clearFileInputs();
      setMessage({ type: "success", text: `Imported ${createdItems.length} track${createdItems.length === 1 ? "" : "s"}.` });
    } else {
      setMessage({
        type: "error",
        text: `Imported ${createdItems.length}, failed ${failures.length}. ${failures.slice(0, 2).join(" ")}`,
      });
    }

    setUploadingBatch(false);
    setBatchProgress(null);
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

  const handleEditMedia = async (media) => {
    const newTitle = window.prompt("Enter new title", media.title);
    if (!newTitle) return;
    const newArtists = window.prompt("Enter artists", media.artists || "");
    if (newArtists === null) return;
    const newDescription = window.prompt("Enter new description", media.description || "");

    try {
      const res = await api(`/api/media/${media.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          artists: newArtists.trim() || null,
          description: newDescription || "",
        }),
      });

      if (!res.ok) throw new Error("Edit failed");

      const updated = await res.json();
      setCategoryMedia((prev) => prev.map((item) => (item.id === media.id ? updated : item)));
      setMessage({ type: "success", text: `Updated "${updated.title}".` });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div className="premium-app-shell" style={styles.page}>
        <header className="app-header" style={styles.header}>
          <div style={styles.headerBlock}>
            <div>
              <div style={styles.headerTitle}>Admin Panel</div>
              <div style={styles.headerNote}>Tree categories and selected-category media management</div>
            </div>
          </div>
          <div style={styles.headerActions}>
            <ThemeToggle style={styles.button("secondary")} />
            <button type="button" style={styles.button("secondary")} onClick={() => openCategoryModal("")}>
              Add Category
            </button>
            <button
              type="button"
              style={styles.button("secondary", !selectedCategory)}
              disabled={!selectedCategory}
              onClick={() => openCategoryModal(selectedCategory?.id)}
            >
              Add Child
            </button>
            <button
              type="button"
              style={styles.button("primary", !selectedCategory)}
              disabled={!selectedCategory}
              onClick={() => openMediaModal(selectedCategory.id)}
            >
              Add Media
            </button>
          </div>
        </header>

        <main className="app-main" style={styles.main}>
          {message && (
            <div style={styles.notice(message.type)}>
              <span>{message.type === "error" ? "⚠️" : "✅"}</span>
              <span>{message.text}</span>
            </div>
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
            <div style={styles.modalGrid}>
              <section style={styles.panel}>
                <div style={styles.panelHeader}>
                  <h3 style={styles.cardTitle}>Existing Media</h3>
                  <p style={styles.cardSubtitle}>
                    {activeMediaCategory
                      ? `Stored in ${activeMediaCategory.path || activeMediaCategory.name}`
                      : "The selected category is no longer available."}
                  </p>
                </div>
                <div style={styles.panelBody}>
                  {loadingMedia ? (
                    <div style={{ ...styles.emptyState, padding: "18px 8px" }}>
                      <span style={styles.spinner} />
                      <p style={{ marginTop: 10, marginBottom: 0 }}>Loading media...</p>
                    </div>
                  ) : categoryMedia.length === 0 ? (
                    <div style={{ ...styles.emptyState, padding: "18px 8px" }}>
                      <div style={styles.emptyIcon}>🎞️</div>
                      <div style={{ fontWeight: 700, color: "var(--text)" }}>No media in this category</div>
                      <p style={{ marginTop: 6, marginBottom: 0 }}>Use the upload form on the right to add the first item.</p>
                    </div>
                  ) : (
                    <div style={styles.mediaList}>
                      {categoryMedia.map((media) => (
                        <div key={media.id} style={styles.mediaItem}>
                          <div style={{ minWidth: 0 }}>
                            <div style={styles.mediaTitle} title={media.title}>
                              {media.title}
                            </div>
                            <div style={styles.mediaMeta}>
                              {media.artists?.trim() ? `${media.artists} · ` : ""}
                              {media.duration != null ? formatDuration(media.duration) : "Unknown duration"}
                              {" · "}
                              {media.mime_type || "Unknown type"}
                            </div>
                          </div>
                          <div style={styles.rowActions}>
                            <button
                              type="button"
                              style={styles.button("secondary")}
                              onClick={() => handleEditMedia(media)}
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
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section style={styles.panel}>
                <div style={styles.panelHeader}>
                  <h3 style={styles.cardTitle}>Upload Media</h3>
                  <p style={styles.cardSubtitle}>This upload will always target the selected category.</p>
                </div>
                <div style={styles.panelBody}>
                  <div style={styles.fieldGroup}>
                    <label style={styles.label}>Category</label>
                    <div
                      style={{
                        ...styles.input,
                        display: "flex",
                        alignItems: "center",
                        minHeight: 42,
                        cursor: "default",
                        background: "var(--bg)",
                      }}
                    >
                      {activeMediaCategory ? (activeMediaCategory.path || activeMediaCategory.name) : "No category selected"}
                    </div>
                  </div>

                  <form onSubmit={handleUploadMedia}>
                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>Title</label>
                      <input
                        style={styles.input}
                        value={mediaTitle}
                        onChange={(event) => setMediaTitle(event.target.value)}
                        placeholder="My Video"
                      />
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>
                        Artists{" "}
                        <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
                      </label>
                      <input
                        style={styles.input}
                        value={mediaArtists}
                        onChange={(event) => setMediaArtists(event.target.value)}
                        placeholder="Unknown Artist"
                      />
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>
                        Description{" "}
                        <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
                      </label>
                      <textarea
                        style={styles.textarea}
                        value={mediaDescription}
                        onChange={(event) => setMediaDescription(event.target.value)}
                        placeholder="A short description..."
                      />
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>File</label>
                      <input
                        id="admin-media-file"
                        type="file"
                        accept="video/*,audio/*,image/*"
                        onChange={(event) => setMediaFile(event.target.files[0] || null)}
                        style={styles.fileInput}
                      />
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>
                        Custom Thumbnail{" "}
                        <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
                      </label>
                      <input
                        id="admin-media-thumb"
                        type="file"
                        accept="image/*"
                        onChange={(event) => setMediaThumb(event.target.files[0] || null)}
                        style={styles.fileInput}
                      />
                      <p style={styles.helpText}>
                        If omitted, videos/images generate a preview and audio tries embedded cover art.
                      </p>
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>
                        Synchronized Lyrics{" "}
                        <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(Whisper JSON, optional)</span>
                      </label>
                      <input
                        id="admin-media-lyrics"
                        type="file"
                        accept="application/json,.json"
                        onChange={(event) => setMediaLyrics(event.target.files[0] || null)}
                        style={styles.fileInput}
                      />
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>
                        Duration <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(seconds, optional)</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        style={styles.input}
                        value={mediaDuration}
                        onChange={(event) => setMediaDuration(event.target.value)}
                        placeholder="180"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={uploadingMedia || !activeMediaCategory}
                      style={styles.button("primary", uploadingMedia || !activeMediaCategory)}
                    >
                      {uploadingMedia && <span style={styles.spinner} />}
                      {uploadingMedia
                        ? `Uploading${uploadProgress === null ? "..." : ` ${uploadProgress}%`}`
                        : "Upload Media"}
                    </button>
                  </form>

                  <div style={styles.divider} />

                  <form onSubmit={handleUploadBatch}>
                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>Music Folder Import</label>
                      <input
                        id="admin-media-batch-folder"
                        type="file"
                        multiple
                        webkitdirectory=""
                        directory=""
                        accept="audio/*,image/*,application/json,.flac,.wav,.m4a,.mp3,.ogg,.opus,.aac,.json"
                        onChange={(event) => setBatchFiles(Array.from(event.target.files || []))}
                        style={styles.fileInput}
                      />
                      <p style={styles.helpText}>
                        Select an album folder. Matching JSON lyrics and cover/front-cover images are attached automatically.
                      </p>
                    </div>

                    <div style={styles.fieldGroup}>
                      <label style={styles.label}>Music Files Import</label>
                      <input
                        id="admin-media-batch-files"
                        type="file"
                        multiple
                        accept="audio/*,image/*,application/json,.flac,.wav,.m4a,.mp3,.ogg,.opus,.aac,.json"
                        onChange={(event) => setBatchFiles(Array.from(event.target.files || []))}
                        style={styles.fileInput}
                      />
                      <p style={styles.helpText}>
                        Use this when you only have loose files, like a single FLAC/WAV plus an optional cover image.
                      </p>
                    </div>

                    {batchFiles.length > 0 && (
                      <div style={styles.fieldGroup}>
                        <label style={styles.label}>Detected Tracks</label>
                        {batchItems.length === 0 ? (
                          <p style={styles.helpText}>No audio files found in that selection.</p>
                        ) : (
                          <div style={styles.batchPreview}>
                            {batchItems.map((item) => (
                              <div key={item.key} style={styles.batchItem}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={styles.batchTitle} title={item.title}>
                                    {item.title}
                                  </div>
                                  <div style={styles.batchMeta} title={item.file.webkitRelativePath || item.file.name}>
                                    {item.file.webkitRelativePath || item.file.name}
                                    {item.thumbnail ? ` · cover: ${item.thumbnail.name}` : " · no cover file"}
                                    {item.lyrics ? ` · lyrics: ${item.lyrics.name}` : " · no lyrics"}
                                  </div>
                                </div>
                                <span style={styles.batchBadge}>
                                  {getExt(item.file.name).toUpperCase()}
                                  {item.skippedCount ? ` +${item.skippedCount}` : ""}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={uploadingBatch || !activeMediaCategory || batchItems.length === 0}
                      style={styles.button("secondary", uploadingBatch || !activeMediaCategory || batchItems.length === 0)}
                    >
                      {uploadingBatch && <span style={styles.spinner} />}
                      {uploadingBatch
                        ? `Importing${batchProgress === null ? "..." : ` ${batchProgress}%`}`
                        : "Import Tracks"}
                    </button>
                  </form>
                </div>
              </section>
            </div>
          </Modal>
        )}
      </div>
    </>
  );
}
