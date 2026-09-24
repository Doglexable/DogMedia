import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCloudArrowUp } from "@fortawesome/free-solid-svg-icons/faCloudArrowUp";
import { faFilm } from "@fortawesome/free-solid-svg-icons/faFilm";
import { faFolderOpen } from "@fortawesome/free-solid-svg-icons/faFolderOpen";
import { faMusic } from "@fortawesome/free-solid-svg-icons/faMusic";
import { useAccess } from "../../access-context";
import { api } from "../../api";
import { useLibrary } from "../library-shell";
import { useGlobalPlayerLibrary } from "../GlobalPlayer";
import { buildBatchItems, buildVideoItems, formatUploadRemaining, getExt, summarizeEncodingStatus } from "../../pages/admin-import-utils";
import { CategoryTreeDnd } from "./category-tree-dnd";
import CategoryEditModal from "./CategoryEditModal";
import EpisodeOrderModal from "./EpisodeOrderModal";
import MediaMetadataEditorModal from "./MediaMetadataEditorModal";
import MediaUploadWorkspace, { removeCategoryCover, uploadCategoryCover, uploadMediaInChunks } from "./MediaUploadWorkspace";
import MobileReleaseManager, { uploadAndroidRelease } from "./MobileReleaseManager";
import UploadQueueViewer, { BrowserTransferProgress } from "./UploadQueueViewer";
import "../../pages/admin-media-import.css";

const styles = {
  page: { minHeight: "100vh", background: "var(--bg)", color: "var(--text)" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "0 24px", minHeight: "var(--app-header-height)", borderBottom: "1px solid var(--card-border)", background: "var(--card-bg)", position: "sticky", top: 0, zIndex: 100, flexWrap: "wrap" },
  headerBlock: { display: "flex", alignItems: "center", gap: 12, minWidth: 0 }, headerTitle: { fontWeight: 800, fontSize: "var(--fs-lg)", color: "var(--text)", letterSpacing: "-0.02em" }, headerNote: { fontSize: "var(--fs-xs)", color: "var(--muted)" },
  main: { maxWidth: 1180, margin: "0 auto", padding: "28px 20px 40px", display: "grid", gap: 18 }, mainWithPlayer: { paddingBottom: "calc(var(--player-height) + 38px)" },
  notice: (type) => ({ padding: "12px 14px", borderRadius: 10, border: `1px solid var(--${type === "error" ? "warning" : "success"}-border)`, background: `var(--${type === "error" ? "warning" : "success"}-bg)`, color: `var(--${type === "error" ? "warning" : "success"}-text)`, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }),
  toolbar: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 20px", border: "1px solid var(--card-border)", borderRadius: 16, background: "linear-gradient(180deg, var(--card-bg), var(--bg))", boxShadow: "0 10px 30px rgba(0, 0, 0, 0.04)", flexWrap: "wrap" },
  toolbarCopy: { minWidth: 0 }, toolbarLabel: { fontSize: "var(--fs-xs)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4, fontWeight: 700 }, toolbarValue: { fontSize: "var(--fs-md)", fontWeight: 700, color: "var(--text)", lineHeight: 1.3, wordBreak: "break-word" }, toolbarMeta: { marginTop: 4, fontSize: "var(--fs-xs)", color: "var(--muted)" }, actionRow: { display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" },
  button: (v = "primary", d = false) => { const p = { primary: { bg: d ? "var(--card-border)" : "var(--primary)", c: d ? "var(--muted)" : "#fff", b: "transparent" }, secondary: { bg: d ? "var(--bg)" : "var(--card-bg)", c: d ? "var(--muted)" : "var(--text)", b: "var(--card-border)" }, danger: { bg: d ? "var(--bg)" : "var(--warning-bg)", c: d ? "var(--muted)" : "var(--warning-text)", b: "var(--warning-border)" } }[v]; return { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 14px", borderRadius: 10, background: p.bg, color: p.c, border: `1px solid ${p.b}`, fontWeight: 700, fontSize: "var(--fs-sm)", cursor: d ? "not-allowed" : "pointer", opacity: d ? 0.7 : 1, fontFamily: "inherit" }; },
  tableCard: { border: "1px solid var(--card-border)", borderRadius: 16, background: "var(--card-bg)", overflow: "hidden" }, tableHeader: { padding: "18px 20px 14px", borderBottom: "1px solid var(--card-border)" }, cardTitle: { margin: 0, fontSize: "var(--fs-md)", fontWeight: 800, color: "var(--text)" }, cardSubtitle: { marginTop: 4, marginBottom: 0, fontSize: "var(--fs-xs)", color: "var(--muted)" }, rowActions: { display: "flex", gap: 8, flexWrap: "wrap" }, emptyState: { padding: "34px 24px", textAlign: "center", color: "var(--muted)" }, emptyIcon: { fontSize: 36, marginBottom: 8 },
  modalOverlay: { position: "fixed", inset: 0, zIndex: 600, background: "var(--modal-overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }, modal: { width: "100%", background: "var(--modal-bg)", color: "var(--modal-text)", borderRadius: 18, border: "1px solid var(--card-border)", boxShadow: "var(--modal-shadow)", overflow: "hidden", maxHeight: "92vh", display: "flex", flexDirection: "column" }, modalHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "18px 20px", borderBottom: "1px solid var(--card-border)" }, modalTitle: { margin: 0, fontSize: 18, fontWeight: 800 }, modalSubtitle: { margin: "4px 0 0", fontSize: 12, color: "var(--muted)" }, modalBody: { padding: 18, overflowY: "auto" }, modalClose: { display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "8px 12px", borderRadius: 10, border: "1px solid var(--card-border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "inherit" },
  panel: { border: "1px solid var(--card-border)", borderRadius: 14, background: "var(--card-bg)", overflow: "hidden" }, panelHeader: { padding: "16px 16px 12px", borderBottom: "1px solid var(--card-border)" }, panelBody: { padding: 16 }, fieldGroup: { marginBottom: 14 }, label: { display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--muted)", marginBottom: 6 }, input: { width: "100%", padding: "10px 12px", border: "1px solid var(--card-border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box", outline: "none", fontFamily: "inherit" }, textarea: { width: "100%", padding: "10px 12px", border: "1px solid var(--card-border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box", outline: "none", resize: "vertical", minHeight: 84, fontFamily: "inherit" }, fileInput: { width: "100%", padding: "10px 12px", border: "1px solid var(--card-border)", borderRadius: 10, background: "var(--bg)", color: "var(--text)", fontSize: 14, boxSizing: "border-box", cursor: "pointer", fontFamily: "inherit" }, helpText: { marginTop: 6, fontSize: 11, color: "var(--muted)", lineHeight: 1.4 },
  batchSummary: { display: "grid", gap: 8, marginTop: 10 }, batchSummaryItem: { border: "1px solid var(--card-border)", borderRadius: 10, background: "var(--bg)", padding: "10px 12px" }, batchSummaryLabel: { fontSize: 10, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)" }, batchSummaryValue: { marginTop: 4, fontSize: 16, fontWeight: 800, color: "var(--text)" }, mediaList: { display: "flex", flexDirection: "column", gap: 10 }, mediaItem: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 12px", border: "1px solid var(--card-border)", borderRadius: 12, background: "var(--bg)" }, mediaTitle: { fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }, mediaMeta: { fontSize: 12, color: "var(--muted)" }, spinner: { width: 14, height: 14, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite", display: "inline-block" },
};

function formatDuration(sec) { const s = Number.parseInt(sec, 10); return !Number.isFinite(s) || s < 0 ? "0:00" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function formatBytes(bytes) {
  const v = Number(bytes) || 0; if (v < 1024) return `${v} B`;
  const units = ["KB", "MB", "GB"]; let size = v, unit = "B"; for (const u of units) { size /= 1024; unit = u; if (size < 1024) break; }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}
function EncodingProgress({ detailed = false, status }) {
  const s = summarizeEncodingStatus(status); if (!s) return null;
  return (<div className={`admin-encoding-progress${detailed ? " admin-encoding-progress--detailed" : ""}`}><div className="admin-encoding-progress__header"><span>{s.label}</span><strong>{s.percent}%</strong></div><div className="admin-encoding-progress__track" role="progressbar" aria-label="Lower-resolution encoding progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={s.percent}><span style={{ width: `${s.percent}%` }} /></div>{detailed && (<div className="admin-encoding-progress__qualities">{s.qualities.map((item) => (<span key={item.quality} data-status={item.status}>{item.quality.toUpperCase()} · {item.status}{item.status === "processing" ? ` ${item.progress}%` : ""}</span>))}</div>)}</div>);
}
function orderCategories(cats) { return [...cats].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || a.name.localeCompare(b.name) || Number(a.id) - Number(b.id)); }
function orderMedia(items) {
  return [...items].sort((a, b) => {
    const aT = Number.isInteger(Number(a.track_order)) && Number(a.track_order) >= 1 ? Number(a.track_order) : Number.POSITIVE_INFINITY;
    const bT = Number.isInteger(Number(b.track_order)) && Number(b.track_order) >= 1 ? Number(b.track_order) : Number.POSITIVE_INFINITY;
    return aT - bT || Number(a.id) - Number(b.id);
  });
}
function applyCategoryMove(cats, catId, pId, idx) {
  const numId = Number(catId), normPid = pId == null ? null : Number(pId), moved = cats.find((c) => Number(c.id) === numId);
  if (!moved) return cats;
  const oldPid = moved.parent_id == null ? null : Number(moved.parent_id), dest = orderCategories(cats.filter((c) => Number(c.id) !== numId && (c.parent_id == null ? null : Number(c.parent_id)) === normPid));
  dest.splice(Math.min(Math.max(idx, 0), dest.length), 0, moved);
  const positions = new Map(dest.map((c, pos) => [Number(c.id), pos]));
  if (oldPid !== normPid) orderCategories(cats.filter((c) => Number(c.id) !== numId && (c.parent_id == null ? null : Number(c.parent_id)) === oldPid)).forEach((c, pos) => positions.set(Number(c.id), pos));
  const parent = normPid == null ? null : cats.find((c) => Number(c.id) === normPid), descIds = new Set([numId]);
  let found = true; while (found) { found = false; for (const c of cats) { if (!descIds.has(Number(c.id)) && descIds.has(Number(c.parent_id))) { descIds.add(Number(c.id)); found = true; } } }
  const updated = cats.map((c) => { const id = Number(c.id), changes = positions.has(id) ? { sort_order: positions.get(id) } : {}; if (id === numId) changes.parent_id = normPid; if (parent && descIds.has(id)) changes.min_access_tier = parent.min_access_tier; return Object.keys(changes).length ? { ...c, ...changes } : c; });
  const byP = new Map(); for (const c of updated) { const k = c.parent_id ?? null, a = byP.get(k) || []; a.push(c); byP.set(k, a); }
  const tree = new Map(), walk = (cur = null, depth = 0, parts = []) => { for (const ch of orderCategories(byP.get(cur) || [])) { const n = [...parts, ch.name]; tree.set(Number(ch.id), { depth, path: n.join(" / ") }); walk(ch.id, depth + 1, n); } };
  walk(); return updated.map((c) => ({ ...c, ...tree.get(Number(c.id)) }));
}
function Modal({ title, subtitle, children, onClose, width = 960 }) {
  useEffect(() => { const h = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (<div className="admin-modal-overlay premium-modal-overlay" style={styles.modalOverlay} onClick={onClose}><div className="admin-modal premium-modal" style={{ ...styles.modal, maxWidth: width }} onClick={(e) => e.stopPropagation()}><div className="admin-modal-header" style={styles.modalHeader}><div><h2 style={styles.modalTitle}>{title}</h2>{subtitle && <p style={styles.modalSubtitle}>{subtitle}</p>}</div><button type="button" style={styles.modalClose} onClick={onClose}>Close</button></div><div className="admin-modal-body" style={styles.modalBody}>{children}</div></div></div>);
}
function clearFileInputs() { ["admin-media-file", "admin-media-thumb", "admin-category-cover-file", "admin-media-batch-folder", "admin-media-batch-files"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; }); }
async function readApiError(res, fallback) { const t = await res.text().catch(() => ""); if (!t) return fallback; try { return JSON.parse(t).error || fallback; } catch { return t.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || fallback; } }

export default function CategoryManager() {
  const { tier } = useAccess();
  const { categories: globalCategories, refreshCategories: refreshGlobalCategories } = useLibrary();
  const player = useGlobalPlayerLibrary();
  const [categories, setCategories] = useState(globalCategories), [selectedCategoryId, setSelectedCategoryId] = useState(null), [message, setMessage] = useState(null), [movingCategory, setMovingCategory] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false), [categoryModalTarget, setCategoryModalTarget] = useState(null);
  const [mediaModalCategoryId, setMediaModalCategoryId] = useState(null), [mediaWorkspaceTab, setMediaWorkspaceTab] = useState("collection"), [videoKind, setVideoKind] = useState("episode"), [categoryMedia, setCategoryMedia] = useState([]);
  const [mediaDescription, setMediaDescription] = useState(""), [videoFiles, setVideoFiles] = useState([]), [videoOverrides, setVideoOverrides] = useState({}), [mediaThumb, setMediaThumb] = useState(null), [categoryCoverFile, setCategoryCoverFile] = useState(null), [updatingCategoryCover, setUpdatingCategoryCover] = useState(false), [removingCategoryCover, setRemovingCategoryCover] = useState(false);
  const [batchFiles, setBatchFiles] = useState([]), [batchArtist, setBatchArtist] = useState(""), [batchOverrides, setBatchOverrides] = useState({});
  const [uploadingMedia, setUploadingMedia] = useState(false), [uploadingBatch, setUploadingBatch] = useState(false), [uploadProgress, setUploadProgress] = useState(null), [batchProgress, setBatchProgress] = useState(null), [uploadEtaSeconds, setUploadEtaSeconds] = useState(null), [batchEtaSeconds, setBatchEtaSeconds] = useState(null), [loadingMedia, setLoadingMedia] = useState(false);
  const [editingMedia, setEditingMedia] = useState(null), [episodeModalOpen, setEpisodeModalOpen] = useState(false), [scanningTrackOrders, setScanningTrackOrders] = useState(false);
  const [mobileRelease, setMobileRelease] = useState(null), [releaseVersion, setReleaseVersion] = useState("0.1.0"), [releaseFile, setReleaseFile] = useState(null), [uploadingRelease, setUploadingRelease] = useState(false), [releaseProgress, setReleaseProgress] = useState(null);
  const [uploadQueueOpen, setUploadQueueOpen] = useState(false), [uploadQueueJobs, setUploadQueueJobs] = useState([]), [uploadQueueSummary, setUploadQueueSummary] = useState({ queued: 0, processing: 0, completed: 0, failed: 0 }), [uploadQueueLoading, setUploadQueueLoading] = useState(false), [uploadQueueError, setUploadQueueError] = useState("");

  const mediaUploadActive = uploadingMedia || uploadingBatch || updatingCategoryCover || removingCategoryCover;
  const browserTransferActive = mediaUploadActive || uploadingRelease;

  const refreshUploadQueue = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setUploadQueueLoading(true);
    try {
      const res = await api("/api/media/uploads/queue"); if (!res.ok) throw new Error(await readApiError(res, "Could not load the upload worker queue"));
      const data = await res.json(); setUploadQueueJobs(Array.isArray(data.jobs) ? data.jobs : []); setUploadQueueSummary(data.summary || { queued: 0, processing: 0, completed: 0, failed: 0 }); setUploadQueueError("");
    } catch (err) { setUploadQueueError(err.message); } finally { if (!silent) setUploadQueueLoading(false); }
  }, []);

  const openUploadQueue = useCallback(() => { setUploadQueueOpen(true); void refreshUploadQueue(); }, [refreshUploadQueue]);
  useEffect(() => { void refreshUploadQueue({ silent: true }); }, [refreshUploadQueue]);

  useEffect(() => {
    const active = uploadQueueSummary.queued + uploadQueueSummary.processing; if (!uploadQueueOpen && active === 0) return undefined;
    const refVis = () => { if (document.visibilityState === "visible") void refreshUploadQueue({ silent: true }); };
    const interval = window.setInterval(refVis, uploadQueueOpen ? 1500 : 5000); document.addEventListener("visibilitychange", refVis);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refVis); };
  }, [refreshUploadQueue, uploadQueueOpen, uploadQueueSummary.processing, uploadQueueSummary.queued]);

  useEffect(() => {
    let cancelled = false;
    const loadMobile = async () => { try { const res = await api("/api/mobile-release"); if (!res.ok) throw new Error(); const data = await res.json(); if (!cancelled) { setMobileRelease(data); if (data.available && data.version) setReleaseVersion(data.version); } } catch { if (!cancelled) setMobileRelease({ available: false }); } };
    loadMobile(); return () => { cancelled = true; };
  }, []);

  useEffect(() => { setCategories(globalCategories); }, [globalCategories]);

  useEffect(() => {
    if (!browserTransferActive) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [browserTransferActive]);

  useEffect(() => {
    if (!categoryModalOpen && mediaModalCategoryId === null && editingMedia === null && !episodeModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [categoryModalOpen, mediaModalCategoryId, editingMedia, episodeModalOpen]);

  useEffect(() => {
    if (mediaModalCategoryId === null) return;
    let cancelled = false;
    const loadMedia = async () => { setLoadingMedia(true); try { const res = await api(`/api/media?category_id=${mediaModalCategoryId}`); const data = await res.json(); if (!cancelled) setCategoryMedia(Array.isArray(data) ? orderMedia(data) : []); } catch { if (!cancelled) setMessage({ type: "error", text: "Failed to load category media." }); } finally { if (!cancelled) setLoadingMedia(false); } };
    loadMedia(); return () => { cancelled = true; };
  }, [mediaModalCategoryId]);

  const batchItems = useMemo(() => buildBatchItems(batchFiles), [batchFiles]);
  const videoItems = useMemo(() => buildVideoItems(videoFiles), [videoFiles]);
  const videoHasInvalidRows = useMemo(() => {
    const orders = [];
    const inv = videoItems.some((i) => {
      const o = videoOverrides[i.key] || {}, t = String(o.title ?? i.title).trim(), tr = String(o.trackOrder ?? i.trackOrder).trim();
      orders.push(tr);
      return !t || !/^\d+$/.test(tr) || Number(tr) < 1;
    });
    return inv || new Set(orders).size !== orders.length;
  }, [videoItems, videoOverrides]);
  const filmSelectionInvalid = videoKind === "film" && videoItems.length !== 1;
  const batchHasInvalidRows = useMemo(() => batchItems.some((i) => {
    const o = batchOverrides[i.key] || {}, t = String(o.title ?? i.title).trim(), tr = o.trackOrder ?? i.trackOrder ?? "";
    return !t || (String(tr).trim() !== "" && (!/^\d+$/.test(String(tr)) || Number(tr) < 1));
  }), [batchItems, batchOverrides]);
  const batchSummary = useMemo(() => ({
    files: batchFiles.length, tracks: batchItems.length,
    covers: new Set(batchItems.filter((i) => i.thumbnail).map((i) => i.thumbnail)).size,
    lyrics: batchItems.filter((i) => i.lyrics).length, skipped: batchItems.reduce((s, i) => s + i.skippedCount, 0),
    bytes: batchItems.reduce((s, i) => s + (i.file?.size || 0), 0),
  }), [batchFiles, batchItems]);

  const activeBrowserTransfer = uploadingMedia ? { title: `Uploading ${videoItems.length} video${videoItems.length === 1 ? "" : "s"}`, progress: uploadProgress, detail: uploadProgress >= 100 ? "Transfer complete; waiting for the media worker." : formatUploadRemaining(uploadEtaSeconds) }
    : uploadingBatch ? { title: `Importing ${batchItems.length} music track${batchItems.length === 1 ? "" : "s"}`, progress: batchProgress, detail: batchProgress >= 100 ? "Transfer complete; waiting for the media worker." : formatUploadRemaining(batchEtaSeconds) }
    : updatingCategoryCover ? { title: "Updating folder artwork", progress: null, detail: "Uploading and optimizing the new cover." }
    : removingCategoryCover ? { title: "Removing folder artwork", progress: null, detail: "Restoring the folder artwork fallback." }
    : uploadingRelease ? { title: `Uploading Android ${releaseVersion.trim() || "release"}`, progress: releaseProgress, detail: "Sending the APK to the server." } : null;

  if (tier < 100) return <Navigate to="/" replace />;
  const selectedCategory = selectedCategoryId ? categories.find((c) => String(c.id) === String(selectedCategoryId)) : null;
  const activeMediaCategory = mediaModalCategoryId ? categories.find((c) => String(c.id) === String(mediaModalCategoryId)) : null;

  const openCategoryModal = (target = "") => {
    setMessage(null); setMediaModalCategoryId(null);
    if (!target) setCategoryModalTarget(null); else if (typeof target === "object") setCategoryModalTarget(target);
    else { const p = categories.find((c) => String(c.id) === String(target)); setCategoryModalTarget(p ? { isChild: true, id: p.id, parent_id: p.id } : null); }
    setCategoryModalOpen(true);
  };
  const openMediaModal = (catId) => {
    setMessage(null); setCategoryModalOpen(false); setMediaModalCategoryId(String(catId)); setMediaWorkspaceTab("collection"); setVideoKind("episode"); setCategoryMedia([]); setMediaDescription(""); setVideoFiles([]); setVideoOverrides({}); setMediaThumb(null); setCategoryCoverFile(null); setUpdatingCategoryCover(false); setRemovingCategoryCover(false); setBatchFiles([]); setBatchArtist(""); setBatchOverrides({}); setEditingMedia(null); setEpisodeModalOpen(false); clearFileInputs(); setSelectedCategoryId(String(catId));
  };
  const closeMediaModal = () => {
    setMediaModalCategoryId(null); setCategoryMedia([]); setLoadingMedia(false);
    if (!mediaUploadActive) { setMediaDescription(""); setVideoFiles([]); setVideoOverrides({}); setMediaThumb(null); setCategoryCoverFile(null); setBatchFiles([]); setBatchArtist(""); setBatchOverrides({}); clearFileInputs(); }
    setEditingMedia(null); setEpisodeModalOpen(false);
  };

  const refreshCategories = async () => {
    const data = await refreshGlobalCategories(); if (!Array.isArray(data)) throw new Error("Failed to refresh categories"); setCategories(data);
  };
  const refreshCategoryMedia = async (fallbackItems) => {
    try {
      const res = await api(`/api/media?category_id=${mediaModalCategoryId}`); if (!res.ok) throw new Error("Category media refresh failed");
      const items = await res.json(); if (!Array.isArray(items)) throw new Error("Invalid category media response");
      const ordered = orderMedia(items); setCategoryMedia(ordered); return ordered;
    } catch { const ordered = orderMedia(fallbackItems); setCategoryMedia(ordered); return ordered; }
  };

  const handleSaveCategory = async ({ id, name, description, parentId, minAccessTier, coverFile }) => {
    let catId = id;
    if (id) {
      const res = await api(`/api/categories/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, min_access_tier: minAccessTier, parent_id: parentId }) }); if (!res.ok) throw new Error(await readApiError(res, "Failed to update category"));
      const updated = await res.json(); setMessage({ type: "success", text: `Category "${updated.name}" updated.` });
    } else {
      const res = await api("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, min_access_tier: minAccessTier, parent_id: parentId }) }); if (!res.ok) throw new Error(await readApiError(res, "Failed to create category"));
      const created = await res.json(); catId = created.id; setSelectedCategoryId(String(created.id)); setMessage({ type: "success", text: `Category "${created.name}" created.` });
    }
    if (coverFile && catId) await uploadCategoryCover(catId, coverFile);
    await refreshCategories();
  };

  const handleDeleteCategory = async (category) => {
    const hasChildren = Number(category.child_count || 0) > 0 || categories.some((c) => String(c.parent_id) === String(category.id));
    if (hasChildren) { setMessage({ type: "error", text: "Delete child categories before deleting this category." }); return; }
    if (!window.confirm(`Delete category "${category.path || category.name}"? Media in this category will also be removed from the library.`)) return;
    try { const res = await api(`/api/categories/${category.id}`, { method: "DELETE" }); if (!res.ok) throw new Error(await readApiError(res, "Delete failed")); await refreshCategories(); if (String(selectedCategoryId) === String(category.id)) setSelectedCategoryId(null); setMessage({ type: "success", text: `Deleted category "${category.name}".` }); } catch (err) { setMessage({ type: "error", text: err.message }); }
  };

  const handleMoveCategory = async (categoryId, parentId, index) => {
    if (movingCategory) return false;
    const moved = categories.find((c) => Number(c.id) === Number(categoryId));
    if (!moved) return false;
    const curP = moved.parent_id == null ? null : Number(moved.parent_id), curIdx = orderCategories(categories.filter((c) => (c.parent_id == null ? null : Number(c.parent_id)) === curP)).findIndex((c) => Number(c.id) === Number(categoryId));
    if (curP === parentId && curIdx === index) return true;
    const prev = categories, optimistic = applyCategoryMove(categories, categoryId, parentId, index);
    let persisted = false;
    setMovingCategory(true); setSelectedCategoryId(String(categoryId)); setCategories(optimistic); setMessage(null);
    try {
      const res = await api(`/api/categories/${categoryId}/move`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parentId, index }) }); if (!res.ok) throw new Error(await readApiError(res, "Could not move category"));
      persisted = true; await refreshCategories(); setMessage({ type: "success", text: `Moved "${moved.name}" successfully.` }); return true;
    } catch (err) {
      if (persisted) { setCategories(optimistic); setMessage({ type: "error", text: `Category moved, but the tree could not be refreshed: ${err.message}` }); return true; }
      setCategories(prev); setMessage({ type: "error", text: err.message }); return false;
    } finally { setMovingCategory(false); }
  };

  const handleUpdateCategoryCover = async (e) => {
    e.preventDefault();
    if (!mediaModalCategoryId || !categoryCoverFile) { setMessage({ type: "error", text: "Choose an image for the category cover." }); return; }
    setUpdatingCategoryCover(true); setMessage(null);
    try { await uploadCategoryCover(mediaModalCategoryId, categoryCoverFile); await refreshCategories(); setCategoryCoverFile(null); const input = document.getElementById("admin-category-cover-file"); if (input) input.value = ""; setMessage({ type: "success", text: `Updated the cover for "${activeMediaCategory?.path || activeMediaCategory?.name || "the selected category"}".` }); } catch (err) { setMessage({ type: "error", text: err.message }); } finally { setUpdatingCategoryCover(false); }
  };

  const handleRemoveCategoryCover = async () => {
    if (!mediaModalCategoryId || !activeMediaCategory?.cover_path) return;
    const categoryName = activeMediaCategory.path || activeMediaCategory.name || "the selected folder";
    if (!window.confirm(`Remove the shared artwork from "${categoryName}"?`)) return;
    setRemovingCategoryCover(true); setMessage(null);
    try {
      await removeCategoryCover(mediaModalCategoryId);
      setCategoryCoverFile(null);
      const input = document.getElementById("admin-category-cover-file"); if (input) input.value = "";
      await refreshCategories();
      setMessage({ type: "success", text: `Removed the shared artwork from "${categoryName}".` });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setRemovingCategoryCover(false);
    }
  };

  const handleUploadMedia = async (e) => {
    e.preventDefault();
    if (!mediaModalCategoryId || videoItems.length === 0) { setMessage({ type: "error", text: "Choose a category and at least one supported video file." }); return; }
    if (filmSelectionInvalid) { setMessage({ type: "error", text: "Choose exactly one video file for a film." }); return; }
    if (videoHasInvalidRows) { setMessage({ type: "error", text: "Every video needs a title and a positive order number." }); return; }
    setUploadingMedia(true); setUploadProgress(0); setUploadEtaSeconds(null); setMessage(null);
    const completed = []; let queuedCount = 0; const failures = []; let queueShown = false;
    const showQueueOnce = () => { if (!queueShown) { queueShown = true; openUploadQueue(); } };
    for (const [idx, item] of videoItems.entries()) {
      const o = videoOverrides[item.key] || {};
      try {
        const res = await uploadMediaInChunks({
          categoryId: mediaModalCategoryId, title: String(o.title ?? item.title).trim(), description: mediaDescription, artists: "",
          trackOrder: o.trackOrder ?? item.trackOrder, duration: "", contentKind: videoKind === "episode" ? "video_episode" : videoKind === "film" ? "film" : "video",
          file: item.file, lyricsFile: null, thumbnail: mediaThumb, onWorkerQueued: showQueueOnce,
          onProgress: (p, est) => { setUploadProgress(Math.round(((idx + p / 100) / videoItems.length) * 100)); const rem = videoItems.slice(idx + 1).reduce((tot, n) => tot + n.file.size + (mediaThumb?.size || 0), 0); setUploadEtaSeconds(est ? Math.ceil(est.remainingSeconds + rem / est.bytesPerSecond) : null); },
        });
        if (res.queued) queuedCount += 1; else if (res.media) completed.push(res.media);
      } catch (err) { failures.push(`${item.file.name}: ${err.message}`); }
    }
    try {
      if (completed.length > 0) { await refreshCategoryMedia([...categoryMedia, ...completed]); await refreshCategories().catch(() => {}); setEpisodeModalOpen(true); setMediaWorkspaceTab("collection"); }
      if (queuedCount + completed.length > 0) { setMediaDescription(""); setVideoFiles([]); setVideoOverrides({}); setMediaThumb(null); clearFileInputs(); }
      const accepted = queuedCount + completed.length;
      setMessage(failures.length === 0 ? { type: "success", text: `${accepted} video upload${accepted === 1 ? "" : "s"} accepted.${queuedCount ? ` The worker will finish ${queuedCount} in the background.` : ""}` } : { type: "error", text: `Queued ${accepted}, failed ${failures.length}. ${failures.slice(0, 2).join(" ")}` });
    } finally { setUploadingMedia(false); setUploadProgress(null); setUploadEtaSeconds(null); }
  };

  const handleSaveVideoOrder = async (reorderedItems) => {
    const updated = await Promise.all(reorderedItems.map(async (item) => { const res = await api(`/api/media/${item.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ track_order: item.trackOrder ?? item.track_order, title: item.title }) }); if (!res.ok) throw new Error(await readApiError(res, `Could not reorder ${item.title}`)); return res.json(); }));
    const byId = new Map(updated.map((i) => [Number(i.id), i]));
    setCategoryMedia((cur) => orderMedia(cur.map((i) => byId.get(Number(i.id)) || i)));
    setMessage({ type: "success", text: "Video order saved." });
  };

  const handleUploadBatch = async (e) => {
    e.preventDefault();
    if (!mediaModalCategoryId || batchItems.length === 0) { setMessage({ type: "error", text: "Choose a category and at least one audio file to import." }); return; }
    setUploadingBatch(true); setBatchProgress(0); setBatchEtaSeconds(null); setMessage(null);
    const completed = []; let queuedCount = 0; const failures = []; let queueShown = false;
    const showQueueOnce = () => { if (!queueShown) { queueShown = true; openUploadQueue(); } };
    const batchCover = batchItems.find((i) => i.thumbnail)?.thumbnail || null;
    if (batchCover) {
      try { await uploadCategoryCover(mediaModalCategoryId, batchCover); await refreshCategories(); }
      catch (err) { setUploadingBatch(false); setBatchProgress(null); setBatchEtaSeconds(null); setMessage({ type: "error", text: err.message }); return; }
    }
    for (const [idx, item] of batchItems.entries()) {
      try {
        const o = batchOverrides[item.key] || {};
        const res = await uploadMediaInChunks({
          categoryId: mediaModalCategoryId, title: String(o.title || item.title).trim(), artists: batchArtist,
          trackOrder: o.trackOrder ?? item.trackOrder ?? "", contentKind: "music", file: item.file, lyricsFile: item.lyrics, thumbnail: null,
          onWorkerQueued: showQueueOnce,
          onProgress: (p, est) => { setBatchProgress(Math.round(((idx + p / 100) / batchItems.length) * 100)); const rem = batchItems.slice(idx + 1).reduce((tot, n) => tot + n.file.size, 0); setBatchEtaSeconds(est ? Math.ceil(est.remainingSeconds + rem / est.bytesPerSecond) : null); },
        });
        if (res.queued) queuedCount += 1; else if (res.media) completed.push(res.media);
      } catch (err) { failures.push(`${item.title}: ${err.message}`); }
    }
    if (completed.length > 0) { await refreshCategoryMedia([...categoryMedia, ...completed]); await refreshCategories().catch(() => {}); }
    const accepted = queuedCount + completed.length;
    if (accepted > 0) { setBatchFiles([]); setBatchArtist(""); setBatchOverrides({}); clearFileInputs(); }
    setMessage(failures.length === 0 ? { type: "success", text: `${accepted} track upload${accepted === 1 ? "" : "s"} accepted.${queuedCount ? ` The worker will finish ${queuedCount} in the background.` : ""}` } : { type: "error", text: `Queued ${accepted}, failed ${failures.length}. ${failures.slice(0, 2).join(" ")}` });
    setUploadingBatch(false); setBatchProgress(null); setBatchEtaSeconds(null);
  };

  const handleDeleteMedia = async (media) => {
    if (!window.confirm(`Are you sure you want to delete "${media.title}"? This cannot be undone.`)) return;
    try { const res = await api(`/api/media/${media.id}`, { method: "DELETE" }); if (!res.ok) throw new Error("Delete failed"); setCategoryMedia((prev) => prev.filter((i) => i.id !== media.id)); setMessage({ type: "success", text: `Deleted "${media.title}".` }); } catch (err) { setMessage({ type: "error", text: err.message }); }
  };

  const handleScanTrackOrders = async () => {
    if (!window.confirm("Scan track numbers from every audio file? Valid embedded tags will replace stored track orders.")) return;
    setScanningTrackOrders(true); setMessage(null);
    try {
      const res = await api("/api/media/track-orders/scan", { method: "POST" });
      if (!res.ok) throw new Error(await readApiError(res, "Track metadata scan failed"));
      const result = await res.json();
      if (mediaModalCategoryId !== null) {
        const mRes = await api(`/api/media?category_id=${mediaModalCategoryId}`);
        if (!mRes.ok) throw new Error(await readApiError(mRes, "Media refresh failed"));
        const mItems = await mRes.json(); setCategoryMedia(Array.isArray(mItems) ? orderMedia(mItems) : []);
      }
      setMessage({ type: result.failed ? "error" : "success", text: `Track scan complete: ${result.scanned} scanned, ${result.updated} updated, ${result.missing} without a track tag, ${result.failed} failed.` });
    } catch (err) { setMessage({ type: "error", text: err.message }); }
    finally { setScanningTrackOrders(false); }
  };

  const handleMediaSaved = (updated, { replacementQueued } = {}) => {
    setCategoryMedia((prev) => orderMedia(prev.map((i) => (i.id === updated.id ? updated : i))));
    setMessage({ type: "success", text: replacementQueued ? `Changes saved for "${updated.title}". File processing continues in the background.` : `Updated "${updated.title}".` });
  };

  const handleUploadRelease = async (e) => {
    e.preventDefault();
    if (!releaseVersion.trim() || !releaseFile) { setMessage({ type: "error", text: "Enter a version and choose an Android APK." }); return; }
    setUploadingRelease(true); setReleaseProgress(0); setMessage(null);
    try { const release = await uploadAndroidRelease({ file: releaseFile, version: releaseVersion.trim(), onProgress: setReleaseProgress }); setMobileRelease(release); setReleaseFile(null); const input = document.getElementById("admin-android-release-file"); if (input) input.value = ""; setMessage({ type: "success", text: `Android ${release.version} is ready to download.` }); } catch (err) { setMessage({ type: "error", text: err.message }); } finally { setUploadingRelease(false); setReleaseProgress(null); }
  };

  const handleDeleteRelease = async () => {
    if (!window.confirm("Remove the current Android app release? The download button will become unavailable.")) return;
    try { const res = await api("/api/mobile-release", { method: "DELETE" }); if (!res.ok) throw new Error(await readApiError(res, "Release removal failed")); setMobileRelease({ available: false }); setMessage({ type: "success", text: "Android release removed." }); } catch (err) { setMessage({ type: "error", text: err.message }); }
  };

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div className="premium-app-shell" style={styles.page}>
        <header className="app-header admin-vault-header" style={styles.header}>
          <div style={styles.headerBlock}><div><div className="admin-vault-title" style={styles.headerTitle}>Vault controls</div><div className="admin-vault-note" style={styles.headerNote}>Categories, media, and app distribution</div></div></div>
        </header>
        <main className="app-main admin-vault-main" style={{ ...styles.main, ...(player?.currentMedia ? styles.mainWithPlayer : {}) }}>
          {message && (<div style={styles.notice(message.type)}><span>{message.type === "error" ? "⚠️" : "✅"}</span><span>{message.text}</span></div>)}
          {activeBrowserTransfer && mediaModalCategoryId === null && editingMedia === null && (<BrowserTransferProgress transfer={activeBrowserTransfer} onOpenQueue={openUploadQueue} />)}
          <section className="hero-surface" style={styles.toolbar}>
            <div style={styles.toolbarCopy}><div style={styles.toolbarLabel}>Selected category</div><div style={styles.toolbarValue}>{selectedCategory ? (selectedCategory.path || selectedCategory.name) : "None selected"}</div><div style={styles.toolbarMeta}>{selectedCategory ? `Tier ${selectedCategory.min_access_tier}${selectedCategory.parent_id ? " · nested category" : " · root category"}` : "Choose a row in the table to unlock add-media and add-child actions."}</div></div>
            <div style={styles.actionRow}>
              <button type="button" style={styles.button("secondary")} onClick={openUploadQueue}>Upload queue{activeBrowserTransfer ? ` · ${activeBrowserTransfer.progress === null ? "active" : `${activeBrowserTransfer.progress ?? 0}%`}` : uploadQueueSummary.queued + uploadQueueSummary.processing > 0 ? ` (${uploadQueueSummary.queued + uploadQueueSummary.processing})` : ""}</button>
              <button type="button" style={styles.button("secondary")} onClick={() => openCategoryModal("")}>Create Root</button>
              <button type="button" style={styles.button("secondary", !selectedCategory)} disabled={!selectedCategory} onClick={() => openCategoryModal(selectedCategory?.id)}>Create Child</button>
              <button type="button" style={styles.button("primary", !selectedCategory)} disabled={!selectedCategory} onClick={() => openMediaModal(selectedCategory.id)}>Upload Here</button>
            </div>
          </section>
          <MobileReleaseManager mobileRelease={mobileRelease} onDelete={handleDeleteRelease} onFileChange={setReleaseFile} onSubmit={handleUploadRelease} onVersionChange={setReleaseVersion} releaseFile={releaseFile} releaseProgress={releaseProgress} releaseVersion={releaseVersion} styles={styles} uploading={uploadingRelease} />
          <section className="glass-surface" style={styles.tableCard}>
            <div style={styles.tableHeader}><h2 style={styles.cardTitle}>Category Tree</h2><p style={styles.cardSubtitle}>Drag folders between rows to reorder, onto a folder to nest, or into the root zone to unnest.</p></div>
            {categories.length === 0 ? (<div style={styles.emptyState}><div style={styles.emptyIcon}>🗂️</div><div style={{ fontWeight: 700, color: "var(--text)" }}>No categories yet</div><p style={{ marginTop: 6, marginBottom: 0 }}>Create a root category first, then add children like Music / Evanescence.</p></div>) : (
              <div style={{ padding: 12 }}><CategoryTreeDnd categories={categories} moving={movingCategory} selectedId={selectedCategoryId} onSelect={(id) => setSelectedCategoryId(String(id))} onMove={handleMoveCategory} onManageMedia={openMediaModal} onAddChild={openCategoryModal} onDelete={handleDeleteCategory} /></div>
            )}
          </section>
        </main>
        <CategoryEditModal isOpen={categoryModalOpen} category={categoryModalTarget} categories={categories} onClose={() => setCategoryModalOpen(false)} onSave={handleSaveCategory} />
        {mediaModalCategoryId !== null && (
          <Modal title={activeMediaCategory ? (activeMediaCategory.path || activeMediaCategory.name) : "Selected Category"} subtitle="Manage existing media and upload directly into the selected category." width={1120} onClose={closeMediaModal}>
            {message && (<div role={message.type === "error" ? "alert" : "status" } style={{ ...styles.notice(message.type), marginBottom: 16 }}><span>{message.type === "error" ? "⚠️" : "✅"}</span><span>{message.text}</span></div>)}
            <MediaUploadWorkspace category={activeMediaCategory} file={categoryCoverFile} onFileChange={setCategoryCoverFile} onRemove={handleRemoveCategoryCover} onSubmit={handleUpdateCategoryCover} removing={removingCategoryCover} styles={styles} updating={updatingCategoryCover} />
            <div className="admin-media-tabs" role="tablist" aria-label="Media workspace">
              <button type="button" role="tab" aria-selected={mediaWorkspaceTab === "collection"} className={mediaWorkspaceTab === "collection" ? "admin-media-tab admin-media-tab--active" : "admin-media-tab"} onClick={() => setMediaWorkspaceTab("collection")}><FontAwesomeIcon icon={faFolderOpen} /><span>Collection</span><small>{categoryMedia.length} items</small></button>
              <button type="button" role="tab" aria-selected={mediaWorkspaceTab === "video"} className={mediaWorkspaceTab === "video" ? "admin-media-tab admin-media-tab--active" : "admin-media-tab"} onClick={() => setMediaWorkspaceTab("video")}><FontAwesomeIcon icon={faFilm} /><span>Upload video</span><small>Anime or film</small></button>
              <button type="button" role="tab" aria-selected={mediaWorkspaceTab === "album"} className={mediaWorkspaceTab === "album" ? "admin-media-tab admin-media-tab--active" : "admin-media-tab"} onClick={() => setMediaWorkspaceTab("album")}><FontAwesomeIcon icon={faMusic} /><span>Import album</span><small>Music and lyrics</small></button>
            </div>
            {mediaWorkspaceTab === "collection" && (
              <section style={styles.panel}>
                <div style={styles.panelHeader}><h3 style={styles.cardTitle}>Collection</h3><p style={styles.cardSubtitle}>{activeMediaCategory ? `Stored in ${activeMediaCategory.path || activeMediaCategory.name}` : "The selected category is no longer available."}</p></div>
                <div style={styles.panelBody}>
                  <div style={{ ...styles.actionRow, justifyContent: "space-between", marginBottom: 14 }}>
                    <p style={{ ...styles.helpText, margin: 0 }}>Music uses embedded track numbers. Videos can be arranged manually after upload.</p>
                    <div style={styles.actionRow}>
                      {categoryMedia.some((i) => i.mime_type?.startsWith("video/")) && (<button type="button" style={styles.button("secondary")} onClick={() => setEpisodeModalOpen(true)}>Order videos</button>)}
                      <button type="button" disabled={scanningTrackOrders} style={styles.button("secondary", scanningTrackOrders)} onClick={handleScanTrackOrders}>{scanningTrackOrders && <span style={styles.spinner} />}{scanningTrackOrders ? "Scanning..." : "Scan music order"}</button>
                    </div>
                  </div>
                  {loadingMedia ? (<div style={{ ...styles.emptyState, padding: "18px 8px" }}><span style={styles.spinner} /><p style={{ marginTop: 10, marginBottom: 0 }}>Loading media...</p></div>) : categoryMedia.length === 0 ? (
                    <div style={{ ...styles.emptyState, padding: "18px 8px" }}><div style={styles.emptyIcon}>🎞️</div><div style={{ fontWeight: 700, color: "var(--text)" }}>No media in this category</div><p style={{ marginTop: 6, marginBottom: 0 }}>Choose Upload video or Import album to add the first item.</p></div>
                  ) : (
                    <div style={styles.mediaList}>
                      {categoryMedia.map((media) => (
                        <div key={media.id} className="admin-media-item" style={styles.mediaItem}>
                          <div style={{ minWidth: 0 }}><div style={styles.mediaTitle} title={media.title}>{media.title}</div><div style={styles.mediaMeta}>{media.track_order != null ? `Track ${media.track_order} · ` : ""}{media.artists?.trim() ? `${media.artists} · ` : ""}{media.duration != null ? formatDuration(media.duration) : "Unknown duration"}{" · "}{media.mime_type || "Unknown type"}</div><EncodingProgress status={media.encoding_status} /></div>
                          <div className="admin-media-actions" style={styles.rowActions}><button type="button" style={styles.button("secondary")} onClick={() => setEditingMedia(media)}>Edit</button><button type="button" style={styles.button("danger")} onClick={() => handleDeleteMedia(media)}>Delete</button></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
            {mediaWorkspaceTab === "video" && (
              <section style={styles.panel}>
                <div style={styles.panelHeader}><h3 style={styles.cardTitle}>Upload anime or film</h3><p style={styles.cardSubtitle}>Choose the source first, then confirm the information viewers will see.</p></div>
                <div style={styles.panelBody}>
                  <form onSubmit={handleUploadMedia}>
                    <div className="admin-import-destination"><span>Upload destination</span><strong>{activeMediaCategory ? (activeMediaCategory.path || activeMediaCategory.name) : "No category selected"}</strong></div>
                    <div className="admin-import-step"><div className="admin-import-step-heading"><span>1</span><div><h4>Choose videos</h4><p>Select one film or many anime episodes. MP4, MKV, WebM, MOV, and AVI are accepted.</p></div></div>
                      <input id="admin-media-file" type="file" multiple={videoKind !== "film"} accept="video/*,.mkv,.avi" onChange={(e) => { setVideoFiles(Array.from(e.target.files || [])); setVideoOverrides({}); }} style={styles.fileInput} />
                      {videoItems.length > 0 && <p className="admin-selected-file">{videoItems.length} video selected · {formatBytes(videoItems.reduce((tot, i) => tot + i.file.size, 0))}</p>}
                    </div>
                    <div className="admin-import-step"><div className="admin-import-step-heading"><span>2</span><div><h4>Describe the batch</h4><p>The selected type and optional synopsis are applied to every video.</p></div></div>
                      <div className="admin-kind-options" role="radiogroup" aria-label="Video kind">{[{ value: "episode", label: "Anime episode" }, { value: "film", label: "Film" }, { value: "other", label: "Other video" }].map((opt) => (<label key={opt.value} className={videoKind === opt.value ? "admin-kind-option admin-kind-option--active" : "admin-kind-option"}><input type="radio" name="video-kind" value={opt.value} checked={videoKind === opt.value} onChange={() => setVideoKind(opt.value)} /><span>{opt.label}</span></label>))}</div>
                      <div style={styles.fieldGroup}><label style={styles.label}>Shared synopsis <span className="admin-optional">(optional)</span></label><textarea style={styles.textarea} value={mediaDescription} onChange={(e) => setMediaDescription(e.target.value)} placeholder="A short description applied to every selected video..." /></div>
                    </div>
                    {videoItems.length > 0 && (
                      <div className="admin-import-step"><div className="admin-import-step-heading"><span>3</span><div><h4>Review titles and initial order</h4><p>Episode numbers are read from names such as S01E03, Episode 03, or 03-title. You can reorder everything again after upload.</p></div></div>
                        <div className="admin-track-manifest"><div className="admin-track-manifest-head"><span>Order</span><span>Title</span><span>File</span></div>{videoItems.map((item) => (<div key={item.key} className="admin-track-row"><input aria-label={`Initial order for ${item.title}`} type="number" min="1" value={videoOverrides[item.key]?.trackOrder ?? item.trackOrder} onChange={(e) => setVideoOverrides((cur) => ({ ...cur, [item.key]: { ...cur[item.key], trackOrder: e.target.value } }))} /><input aria-label={`Title for ${item.title}`} value={videoOverrides[item.key]?.title ?? item.title} onChange={(e) => setVideoOverrides((cur) => ({ ...cur, [item.key]: { ...cur[item.key], title: e.target.value } }))} /><div className="admin-track-file" title={item.file.name}><strong>{getExt(item.file.name).toUpperCase()} · {formatBytes(item.file.size)}</strong><span>{item.file.name}</span></div></div>))}</div>
                      </div>
                    )}
                    <div className="admin-import-step"><div className="admin-import-step-heading"><span>4</span><div><h4>{videoKind === "film" ? "Add film artwork" : "Add shared artwork"}</h4><p>{videoKind === "film" ? "Optional. This artwork is attached to the film itself, not the folder. A frame is extracted automatically when left empty." : "The image is copied to every uploaded episode. A frame is extracted from each video when left empty."}</p></div></div>
                      <input id="admin-media-thumb" type="file" accept="image/*" onChange={(e) => setMediaThumb(e.target.files[0] || null)} style={styles.fileInput} />
                      {mediaThumb && <p className="admin-selected-file">Artwork selected · {mediaThumb.name}</p>}
                    </div>
                    <div className="admin-import-footer">
                      <div><strong>{videoItems.length} video{videoItems.length === 1 ? "" : "s"}</strong><span>{formatBytes(videoItems.reduce((tot, i) => tot + i.file.size, 0))} · {uploadingMedia ? uploadProgress >= 100 ? "Transfer complete · follow the worker in Upload queue" : formatUploadRemaining(uploadEtaSeconds) : "duration detected automatically"}</span></div>
                      <button type="submit" disabled={uploadingMedia || !activeMediaCategory || videoItems.length === 0 || videoHasInvalidRows || filmSelectionInvalid} style={styles.button("primary", uploadingMedia || !activeMediaCategory || videoItems.length === 0 || videoHasInvalidRows || filmSelectionInvalid)}>{uploadingMedia && <span style={styles.spinner} />}{uploadingMedia ? uploadProgress >= 100 ? "Waiting for worker" : `Uploading ${uploadProgress ?? 0}%` : `Upload ${videoItems.length} video${videoItems.length === 1 ? "" : "s"}`}</button>
                    </div>
                  </form>
                </div>
              </section>
            )}
            {mediaWorkspaceTab === "album" && (
              <div className="admin-album-workspace">
                <section style={styles.panel}>
                  <div style={styles.panelHeader}><h3 style={styles.cardTitle}>Import a music album</h3><p style={styles.cardSubtitle}>Choose a folder or loose tracks, review the manifest, then import them together.</p></div>
                  <div style={styles.panelBody}>
                    <div className="admin-import-destination"><span>Album destination</span><strong>{activeMediaCategory ? (activeMediaCategory.path || activeMediaCategory.name) : "No category selected"}</strong></div>
                    <form onSubmit={handleUploadBatch}>
                      <div className="admin-import-step"><div className="admin-import-step-heading"><span>1</span><div><h4>Choose the music</h4><p>A folder may include cover artwork and matching Whisper JSON lyrics.</p></div></div>
                        <div className="admin-source-options"><input id="admin-media-batch-folder" className="admin-source-input" type="file" multiple webkitdirectory="" directory="" accept="audio/*,image/*,application/json,.flac,.wav,.m4a,.mp3,.ogg,.opus,.aac,.json" onChange={(e) => { setBatchFiles(Array.from(e.target.files || [])); setBatchOverrides({}); }} /><label className="admin-source-option" htmlFor="admin-media-batch-folder"><FontAwesomeIcon icon={faMusic} /><strong>Choose album folder</strong><span>Best for a complete album</span></label><input id="admin-media-batch-files" className="admin-source-input" type="file" multiple accept="audio/*,image/*,application/json,.flac,.wav,.m4a,.mp3,.ogg,.opus,.aac,.json" onChange={(e) => { setBatchFiles(Array.from(e.target.files || [])); setBatchOverrides({}); }} /><label className="admin-source-option" htmlFor="admin-media-batch-files"><FontAwesomeIcon icon={faCloudArrowUp} /><strong>Choose music files</strong><span>For one or more loose tracks</span></label></div>
                      </div>
                      <div className="admin-import-step"><div className="admin-import-step-heading"><span>2</span><div><h4>Set shared album details</h4><p>Leave the artist blank to read it from each audio file.</p></div></div>
                        <div style={styles.fieldGroup}><label style={styles.label}>Album artist <span className="admin-optional">(optional)</span></label><input style={styles.input} value={batchArtist} onChange={(e) => setBatchArtist(e.target.value)} placeholder="Use embedded artist metadata" /></div>
                      </div>
                      {batchFiles.length > 0 && (
                        <div className="admin-import-step"><div className="admin-import-step-heading"><span>3</span><div><h4>Review the track manifest</h4><p>Correct titles or track numbers before the import starts.</p></div></div>
                          <div className="admin-batch-summary" style={styles.batchSummary}><div style={styles.batchSummaryItem}><div style={styles.batchSummaryLabel}>Tracks</div><div style={styles.batchSummaryValue}>{batchSummary.tracks}</div></div><div style={styles.batchSummaryItem}><div style={styles.batchSummaryLabel}>Covers / lyrics</div><div style={styles.batchSummaryValue}>{batchSummary.covers}/{batchSummary.lyrics}</div></div><div style={styles.batchSummaryItem}><div style={styles.batchSummaryLabel}>Audio size</div><div style={styles.batchSummaryValue}>{formatBytes(batchSummary.bytes)}</div></div></div>
                          <p style={styles.helpText}>Selected {batchSummary.files} file{batchSummary.files === 1 ? "" : "s"}.{batchSummary.skipped ? ` ${batchSummary.skipped} duplicate format candidate${batchSummary.skipped === 1 ? "" : "s"} will be ignored.` : ""}</p>
                          {batchItems.length === 0 ? (<p style={styles.helpText}>No audio files found in that selection.</p>) : (
                            <div className="admin-track-manifest"><div className="admin-track-manifest-head"><span>No.</span><span>Title</span><span>File</span></div>
                              {batchItems.map((item) => (
                                <div key={item.key} className="admin-track-row"><input aria-label={`Track number for ${item.title}`} type="number" min="1" value={batchOverrides[item.key]?.trackOrder ?? item.trackOrder ?? ""} onChange={(e) => setBatchOverrides((cur) => ({ ...cur, [item.key]: { ...cur[item.key], trackOrder: e.target.value } }))} placeholder="—" /><input aria-label={`Title for ${item.title}`} value={batchOverrides[item.key]?.title ?? item.title} onChange={(e) => setBatchOverrides((cur) => ({ ...cur, [item.key]: { ...cur[item.key], title: e.target.value } }))} /><div className="admin-track-file" title={item.file.webkitRelativePath || item.file.name}><strong>{getExt(item.file.name).toUpperCase()} · {formatBytes(item.file.size)}</strong><span>{item.lyrics ? "Lyrics matched" : "No lyrics"}{item.skippedCount ? ` · ${item.skippedCount} duplicate ignored` : ""}</span></div></div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="admin-import-footer">
                        <div><strong>{batchItems.length} track{batchItems.length === 1 ? "" : "s"}</strong><span>{formatBytes(batchSummary.bytes)} · {uploadingBatch ? batchProgress >= 100 ? "Transfer complete · follow the worker in Upload queue" : formatUploadRemaining(batchEtaSeconds) : "ready to import"}</span></div>
                        <button type="submit" disabled={uploadingBatch || !activeMediaCategory || batchItems.length === 0 || batchHasInvalidRows} style={styles.button("primary", uploadingBatch || !activeMediaCategory || batchItems.length === 0 || batchHasInvalidRows)}>{uploadingBatch && <span style={styles.spinner} />}{uploadingBatch ? batchProgress >= 100 ? "Waiting for worker" : `Importing ${batchProgress ?? 0}%` : `Import ${batchItems.length} track${batchItems.length === 1 ? "" : "s"}`}</button>
                      </div>
                    </form>
                  </div>
                </section>
              </div>
            )}
          </Modal>
        )}
        <MediaMetadataEditorModal isOpen={Boolean(editingMedia)} media={editingMedia} onClose={() => setEditingMedia(null)} onSave={handleMediaSaved} onOpenUploadQueue={openUploadQueue} />
        <EpisodeOrderModal isOpen={episodeModalOpen} episodes={categoryMedia.filter((item) => item.mime_type?.startsWith("video/"))} onClose={() => setEpisodeModalOpen(false)} onSaveOrder={handleSaveVideoOrder} />
        {uploadQueueOpen && (
          <Modal title="Upload worker queue" subtitle="Monitor files waiting for or currently handled by the background worker." width={860} onClose={() => setUploadQueueOpen(false)}>
            <UploadQueueViewer browserTransfer={activeBrowserTransfer} error={uploadQueueError} jobs={uploadQueueJobs} loading={uploadQueueLoading} onRefresh={() => refreshUploadQueue()} summary={uploadQueueSummary} />
          </Modal>
        )}
      </div>
    </>
  );
}
