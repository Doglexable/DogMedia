import NetInfo from "@react-native-community/netinfo";
import * as FileSystem from "expo-file-system/legacy";
import { AppState } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, api, apiJson, mediaThumbnailUrl } from "../api";
import {
  clearStoredDownloads,
  createClientEventId,
  deletePlaybackOutbox,
  deleteStoredDownload,
  deleteStoredJob,
  getLocalResume,
  getOfflineDatabase,
  getStoredLease,
  listDirtyResumes,
  listPlaybackOutbox,
  listStoredDownloads,
  listStoredJobs,
  markResumesSynced,
  patchStoredJob,
  queuePlaybackEvent,
  saveLocalResume,
  saveStoredDownload,
  saveStoredJob,
  saveStoredLease,
  updateStoredDownloadStatus,
} from "../offline-store";
import {
  evaluateOfflineLease,
  getDownloadNetworkPolicy,
  hasDownloadDiskSpace,
  OFFLINE_LEASE_DAYS,
  OFFLINE_MAX_CONCURRENT_DOWNLOADS,
  resolveOfflineSource,
} from "../utils/offline";

const OfflineContext = createContext(null);
const OFFLINE_ROOT = `${FileSystem.documentDirectory}offline`;
const AUDIO_DIR = `${OFFLINE_ROOT}/audio`;
const THUMB_DIR = `${OFFLINE_ROOT}/thumbnails`;

function addLeaseDays(now = Date.now()) {
  return new Date(now + OFFLINE_LEASE_DAYS * 86400000).toISOString();
}

function metadataFromManifest(item) {
  return {
    id: Number(item.id), category_id: Number(item.category_id), category_name: item.category_name,
    category_path: item.category_path, title: item.title, description: item.description,
    artists: item.artists, duration: item.duration, mime_type: item.mime_type,
    liked: Boolean(item.liked),
  };
}

function audioExtension(mimeType) {
  return ({
    "audio/mpeg": "mp3", "audio/flac": "flac", "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/ogg": "ogg", "audio/opus": "opus", "audio/mp4": "m4a", "audio/aac": "aac",
  })[mimeType] || "audio";
}

async function ensureOfflineDirectories() {
  await FileSystem.makeDirectoryAsync(AUDIO_DIR, { intermediates: true });
  await FileSystem.makeDirectoryAsync(THUMB_DIR, { intermediates: true });
  const names = await FileSystem.readDirectoryAsync(AUDIO_DIR).catch(() => []);
  await Promise.all(names.filter((name) => name.endsWith(".part")).map((name) => FileSystem.deleteAsync(`${AUDIO_DIR}/${name}`, { idempotent: true })));
}

async function deleteUris(...uris) {
  await Promise.all(uris.filter(Boolean).map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})));
}

export function useOffline() {
  return useContext(OfflineContext);
}

export function OfflineProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [lease, setLease] = useState(null);
  const [downloads, setDownloads] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [network, setNetwork] = useState({ isConnected: null, type: "unknown" });
  const [storage, setStorage] = useState({ freeBytes: 0, totalBytes: 0, usedBytes: 0 });
  const [syncing, setSyncing] = useState(false);
  const activeDownloadsRef = useRef(new Map());
  const activeCellularApprovalRef = useRef(new Map());
  const cancelledDownloadsRef = useRef(new Set());
  const pausedDownloadsRef = useRef(new Set());
  const pumpingRef = useRef(false);
  const syncingRef = useRef(false);

  const refresh = useCallback(async () => {
    const [nextDownloads, nextJobs, nextLease, freeBytes, totalBytes] = await Promise.all([
      listStoredDownloads(), listStoredJobs(), getStoredLease(),
      FileSystem.getFreeDiskStorageAsync().catch(() => 0),
      FileSystem.getTotalDiskCapacityAsync().catch(() => 0),
    ]);
    setDownloads(nextDownloads);
    setJobs(nextJobs);
    setLease(nextLease);
    setStorage({
      freeBytes: Number(freeBytes) || 0,
      totalBytes: Number(totalBytes) || 0,
      usedBytes: nextDownloads.reduce((sum, item) => sum + Number(item.byteSize || 0), 0),
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([getOfflineDatabase(), ensureOfflineDirectories()])
      .then(refresh)
      .finally(() => { if (mounted) setReady(true); });
    const unsubscribe = NetInfo.addEventListener((state) => {
      setNetwork({ isConnected: Boolean(state.isConnected && state.isInternetReachable !== false), type: state.type });
    });
    return () => { mounted = false; unsubscribe(); };
  }, [refresh]);

  const validateAccess = useCallback(async () => {
    try {
      const data = await apiJson("/api/check-access");
      const nextLease = { expiresAt: addLeaseDays(), locked: false, validatedAt: new Date().toISOString() };
      await saveStoredLease(nextLease);
      setLease(nextLease);
      return { ...data, offline: false };
    } catch (error) {
      if (error?.status === 403) {
        const lockedLease = { ...(await getStoredLease()), locked: true, validatedAt: new Date().toISOString() };
        await saveStoredLease(lockedLease);
        setLease(lockedLease);
        const [storedDownloads, storedJobs] = await Promise.all([listStoredDownloads(), listStoredJobs()]);
        if (storedDownloads.length || storedJobs.length) {
          return { tier: 0, description: "Offline downloads locked", firstRun: false, clientIp: null, offline: true, managementOnly: true };
        }
        throw error;
      }
      const stored = await getStoredLease();
      setLease(stored);
      if (evaluateOfflineLease(stored).playable) {
        return { tier: 0, description: "Offline access", firstRun: false, clientIp: null, offline: true };
      }
      const [storedDownloads, storedJobs] = await Promise.all([listStoredDownloads(), listStoredJobs()]);
      if (storedDownloads.length || storedJobs.length) {
        return { tier: 0, description: "Offline validation required", firstRun: false, clientIp: null, offline: true, managementOnly: true };
      }
      throw error;
    }
  }, []);

  const validateDownloads = useCallback(async () => {
    const current = await listStoredDownloads();
    if (!current.length) return;
    const result = await apiJson("/api/offline/validate", {
      method: "POST",
      body: JSON.stringify({ items: current.map((item) => ({ mediaId: item.mediaId, fileVersion: item.fileVersion })) }),
    });
    await Promise.all((result.items || []).map((item) => updateStoredDownloadStatus(
      item.mediaId,
      item.status === "valid" ? "ready" : item.status === "changed" ? "stale" : "locked"
    )));
  }, []);

  const flushSync = useCallback(async () => {
    if (!network.isConnected || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      await validateAccess();
      await validateDownloads();
      const [events, resumes] = await Promise.all([listPlaybackOutbox(), listDirtyResumes()]);
      if (events.length || resumes.length) {
        const result = await apiJson("/api/offline/sync", { method: "POST", body: JSON.stringify({ events, resumes }) });
        await Promise.all([
          deletePlaybackOutbox(result.acceptedEventIds || []),
          markResumesSynced(result.acceptedResumeIds || []),
        ]);
      }
      await refresh();
    } catch {
      // The outbox remains durable for the next validated reconnect.
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [network.isConnected, refresh, validateAccess, validateDownloads]);

  useEffect(() => {
    if (network.isConnected) flushSync();
  }, [flushSync, network.isConnected]);

  useEffect(() => {
    if (network.isConnected && network.type !== "cellular") return;
    for (const [mediaId, download] of activeDownloadsRef.current.entries()) {
      if (network.type === "cellular" && activeCellularApprovalRef.current.get(mediaId)) continue;
      pausedDownloadsRef.current.add(mediaId);
      download.pauseAsync().catch(() => {});
    }
  }, [network.isConnected, network.type]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && network.isConnected) flushSync();
    });
    return () => subscription.remove();
  }, [flushSync, network.isConnected]);

  const processJob = useCallback(async (job) => {
    const item = job.metadata;
    const policy = getDownloadNetworkPolicy({ ...network, cellularApproved: job.cellularApproved });
    if (policy !== "allowed") {
      await patchStoredJob(job.mediaId, { state: "paused", error: policy === "cellular-approval" ? "Waiting for cellular approval" : "Waiting for network" });
      return;
    }
    const freeBytes = await FileSystem.getFreeDiskStorageAsync();
    if (!hasDownloadDiskSpace(freeBytes, item.byteSize)) {
      await patchStoredJob(job.mediaId, { state: "failed", error: "Not enough available storage" });
      return;
    }

    const safeVersion = String(item.fileVersion).replace(/[^a-z0-9_-]/gi, "-");
    const fileUri = `${AUDIO_DIR}/${item.id}-${safeVersion}.${audioExtension(item.mime_type)}`;
    const partUri = `${fileUri}.part`;
    await deleteUris(partUri);
    await patchStoredJob(job.mediaId, { state: "downloading", progress: 0, error: null });
    const download = FileSystem.createDownloadResumable(
      `${API_BASE}/api/offline/media/${item.id}/download`,
      partUri,
      {},
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        const progress = totalBytesExpectedToWrite > 0 ? totalBytesWritten / totalBytesExpectedToWrite : 0;
        patchStoredJob(job.mediaId, { progress }).then(refresh).catch(() => {});
      }
    );
    activeDownloadsRef.current.set(Number(job.mediaId), download);
    activeCellularApprovalRef.current.set(Number(job.mediaId), Boolean(job.cellularApproved));
    try {
      const result = await download.downloadAsync();
      if (!result?.uri || result.status < 200 || result.status >= 300) throw new Error("Download did not complete");
      const info = await FileSystem.getInfoAsync(partUri, { size: true });
      const responseVersion = result.headers?.["X-File-Version"] || result.headers?.["x-file-version"];
      if (!info.exists || Number(info.size) !== Number(item.byteSize) || (responseVersion && responseVersion !== item.fileVersion)) {
        throw new Error("Downloaded file failed verification");
      }
      await deleteUris(fileUri);
      await FileSystem.moveAsync({ from: partUri, to: fileUri });

      let thumbnailUri = null;
      const thumbTarget = `${THUMB_DIR}/${item.id}.image`;
      try {
        const thumb = await FileSystem.downloadAsync(mediaThumbnailUrl(item.id), thumbTarget);
        if (thumb.status >= 200 && thumb.status < 300) thumbnailUri = thumb.uri;
      } catch {
        await deleteUris(thumbTarget);
      }
      let lyrics = null;
      if (item.hasLyrics) {
        try {
          const response = await api(`/api/media/${item.id}/lyrics`);
          if (response.ok) lyrics = await response.json();
        } catch {
          lyrics = null;
        }
      }
      const existing = downloads.find((entry) => entry.mediaId === Number(item.id));
      await saveStoredDownload({
        id: item.id, metadata: metadataFromManifest(item), fileUri, thumbnailUri: thumbnailUri || existing?.thumbnailUri,
        lyrics: lyrics || existing?.lyrics, fileVersion: item.fileVersion, byteSize: item.byteSize, status: "ready",
      });
      if (existing?.fileUri && existing.fileUri !== fileUri) await deleteUris(existing.fileUri);
      await deleteStoredJob(job.mediaId);
    } catch (error) {
      await deleteUris(partUri);
      const cancelled = cancelledDownloadsRef.current.has(Number(job.mediaId));
      const paused = pausedDownloadsRef.current.has(Number(job.mediaId));
      await patchStoredJob(job.mediaId, {
        state: cancelled ? "cancelled" : paused || !network.isConnected ? "paused" : "failed",
        error: cancelled ? null : paused ? "Download paused by network policy" : error?.message || "Download failed",
      });
    } finally {
      cancelledDownloadsRef.current.delete(Number(job.mediaId));
      pausedDownloadsRef.current.delete(Number(job.mediaId));
      activeDownloadsRef.current.delete(Number(job.mediaId));
      activeCellularApprovalRef.current.delete(Number(job.mediaId));
      await refresh();
    }
  }, [downloads, network, refresh]);

  useEffect(() => {
    if (!ready || pumpingRef.current) return;
    const queued = jobs.filter((job) => job.state === "queued" && !activeDownloadsRef.current.has(job.mediaId));
    const slots = Math.max(0, OFFLINE_MAX_CONCURRENT_DOWNLOADS - activeDownloadsRef.current.size);
    if (!queued.length || slots === 0) return;
    pumpingRef.current = true;
    Promise.all(queued.slice(0, slots).map(processJob)).finally(() => { pumpingRef.current = false; refresh(); });
  }, [jobs, processJob, ready, refresh]);

  const enqueueManifest = useCallback(async (items, { cellularApproved = false } = {}) => {
    const policy = getDownloadNetworkPolicy({ ...network, cellularApproved });
    if (policy === "cellular-approval") {
      const error = new Error("Cellular approval required");
      error.code = "CELLULAR_APPROVAL_REQUIRED";
      throw error;
    }
    if (policy === "offline") throw new Error("Connect to a network to start downloads");
    const batchId = createClientEventId();
    await Promise.all(items.map((item) => saveStoredJob({
      mediaId: Number(item.id), batchId, metadata: item, state: "queued", progress: 0, cellularApproved,
    })));
    await refresh();
    return items.length;
  }, [network, refresh]);

  const downloadMedia = useCallback(async (mediaId, options) => {
    const manifest = await apiJson(`/api/offline/manifest?media_id=${Number(mediaId)}`);
    return enqueueManifest(manifest.items || [], options);
  }, [enqueueManifest]);

  const downloadCategory = useCallback(async (categoryId, options) => {
    const manifest = await apiJson(`/api/offline/manifest?category_id=${Number(categoryId)}`);
    return enqueueManifest(manifest.items || [], options);
  }, [enqueueManifest]);

  const cancelDownload = useCallback(async (mediaId) => {
    const active = activeDownloadsRef.current.get(Number(mediaId));
    if (active) {
      cancelledDownloadsRef.current.add(Number(mediaId));
      await active.pauseAsync().catch(() => {});
      await patchStoredJob(mediaId, { state: "cancelled", error: null });
    } else await patchStoredJob(mediaId, { state: "cancelled", error: null });
    await refresh();
  }, [refresh]);

  const retryDownload = useCallback(async (mediaId, { cellularApproved = false } = {}) => {
    const job = (await listStoredJobs()).find((item) => item.mediaId === Number(mediaId));
    if (!job) return;
    await saveStoredJob({ ...job, state: "queued", progress: 0, error: null, cellularApproved });
    await refresh();
  }, [refresh]);

  const removeDownload = useCallback(async (mediaId) => {
    const item = (await listStoredDownloads()).find((entry) => entry.mediaId === Number(mediaId));
    await cancelDownload(mediaId);
    await deleteUris(item?.fileUri, item?.thumbnailUri);
    await Promise.all([deleteStoredDownload(mediaId), deleteStoredJob(mediaId)]);
    await refresh();
  }, [cancelDownload, refresh]);

  const retryAssets = useCallback(async (mediaId) => {
    const existing = (await listStoredDownloads()).find((entry) => entry.mediaId === Number(mediaId));
    if (!existing || !network.isConnected) throw new Error("Connect to refresh offline artwork and lyrics");
    const manifest = await apiJson(`/api/offline/manifest?media_id=${Number(mediaId)}`);
    const item = manifest.items?.[0];
    if (!item) throw new Error("Media is no longer available");
    let thumbnailUri = existing.thumbnailUri;
    let lyrics = existing.lyrics;
    const thumbTarget = `${THUMB_DIR}/${item.id}.image`;
    try {
      const thumb = await FileSystem.downloadAsync(mediaThumbnailUrl(item.id), thumbTarget);
      if (thumb.status >= 200 && thumb.status < 300) thumbnailUri = thumb.uri;
    } catch {
      // Artwork remains optional.
    }
    if (item.hasLyrics) {
      try {
        const response = await api(`/api/media/${item.id}/lyrics`);
        if (response.ok) lyrics = await response.json();
      } catch {
        // Lyrics remain optional.
      }
    }
    await saveStoredDownload({
      id: item.id, metadata: metadataFromManifest(item), fileUri: existing.fileUri, thumbnailUri,
      lyrics, fileVersion: existing.fileVersion, byteSize: existing.byteSize, status: existing.status,
      downloadedAt: existing.downloadedAt,
    });
    await refresh();
  }, [network.isConnected, refresh]);

  const removeAll = useCallback(async () => {
    await Promise.all([...activeDownloadsRef.current.keys()].map(cancelDownload));
    const current = await listStoredDownloads();
    await Promise.all(current.flatMap((item) => [item.fileUri, item.thumbnailUri]).filter(Boolean).map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})));
    await clearStoredDownloads();
    await refresh();
  }, [cancelDownload, refresh]);

  const downloadsById = useMemo(() => new Map(downloads.map((item) => [item.mediaId, item])), [downloads]);
  const leaseState = evaluateOfflineLease(lease);
  const resolveMediaUri = useCallback((mediaId) => resolveOfflineSource(mediaId, downloadsById, lease), [downloadsById, lease]);
  const resolveThumbnailUri = useCallback((mediaId) => downloadsById.get(Number(mediaId))?.thumbnailUri || null, [downloadsById]);
  const getOfflineLyrics = useCallback((mediaId) => downloadsById.get(Number(mediaId))?.lyrics || null, [downloadsById]);
  const recordPlaybackEvent = useCallback((payload) => queuePlaybackEvent(payload), []);
  const saveResume = useCallback((mediaId, position, duration) => saveLocalResume(mediaId, position, duration), []);

  const value = useMemo(() => ({
    cancelDownload, downloadCategory, downloadMedia, downloads, downloadsById, flushSync,
    getLocalResume, getOfflineLyrics, isConnected: Boolean(network.isConnected), jobs, lease,
    leaseState, networkType: network.type, ready, recordPlaybackEvent, removeAll, removeDownload,
    resolveMediaUri, resolveThumbnailUri, retryAssets, retryDownload, saveResume, storage, syncing, validateAccess,
  }), [
    cancelDownload, downloadCategory, downloadMedia, downloads, downloadsById, flushSync, getOfflineLyrics,
    jobs, lease, leaseState, network, ready, recordPlaybackEvent, removeAll, removeDownload,
    resolveMediaUri, resolveThumbnailUri, retryAssets, retryDownload, saveResume, storage, syncing, validateAccess,
  ]);

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
