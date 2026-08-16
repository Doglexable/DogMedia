import * as SQLite from "expo-sqlite";

let databasePromise;

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function createClientEventId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export async function getOfflineDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync("dogmedia-offline.db").then(async (database) => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS offline_lease (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          expires_at TEXT,
          locked INTEGER NOT NULL DEFAULT 0,
          validated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS downloads (
          media_id INTEGER PRIMARY KEY,
          metadata_json TEXT NOT NULL,
          file_uri TEXT NOT NULL,
          thumbnail_uri TEXT,
          lyrics_json TEXT,
          file_version TEXT NOT NULL,
          byte_size INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'ready',
          downloaded_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS download_jobs (
          media_id INTEGER PRIMARY KEY,
          batch_id TEXT NOT NULL,
          metadata_json TEXT NOT NULL,
          state TEXT NOT NULL,
          progress REAL NOT NULL DEFAULT 0,
          error TEXT,
          cellular_approved INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS playback_outbox (
          client_event_id TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_resumes (
          media_id INTEGER PRIMARY KEY,
          position INTEGER NOT NULL,
          duration INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          dirty INTEGER NOT NULL DEFAULT 1
        );
      `);
      await database.runAsync("UPDATE download_jobs SET state = 'paused', error = 'Download interrupted' WHERE state = 'downloading'");
      return database;
    });
  }
  return databasePromise;
}

export async function getStoredLease() {
  const database = await getOfflineDatabase();
  const row = await database.getFirstAsync("SELECT expires_at, locked, validated_at FROM offline_lease WHERE id = 1");
  return row ? { expiresAt: row.expires_at, locked: Boolean(row.locked), validatedAt: row.validated_at } : null;
}

export async function saveStoredLease({ expiresAt, locked = false, validatedAt = new Date().toISOString() }) {
  const database = await getOfflineDatabase();
  await database.runAsync(
    `INSERT INTO offline_lease (id, expires_at, locked, validated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET expires_at = excluded.expires_at, locked = excluded.locked, validated_at = excluded.validated_at`,
    expiresAt || null, locked ? 1 : 0, validatedAt
  );
}

export async function listStoredDownloads() {
  const database = await getOfflineDatabase();
  const rows = await database.getAllAsync("SELECT * FROM downloads ORDER BY downloaded_at DESC");
  return rows.map((row) => ({
    ...parseJson(row.metadata_json, {}),
    mediaId: Number(row.media_id),
    fileUri: row.file_uri,
    thumbnailUri: row.thumbnail_uri,
    lyrics: parseJson(row.lyrics_json),
    fileVersion: row.file_version,
    byteSize: Number(row.byte_size),
    status: row.status,
    downloadedAt: row.downloaded_at,
  }));
}

export async function saveStoredDownload(item) {
  const database = await getOfflineDatabase();
  await database.runAsync(
    `INSERT INTO downloads
     (media_id, metadata_json, file_uri, thumbnail_uri, lyrics_json, file_version, byte_size, status, downloaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(media_id) DO UPDATE SET
       metadata_json = excluded.metadata_json, file_uri = excluded.file_uri,
       thumbnail_uri = excluded.thumbnail_uri, lyrics_json = excluded.lyrics_json,
       file_version = excluded.file_version, byte_size = excluded.byte_size,
       status = excluded.status, downloaded_at = excluded.downloaded_at`,
    Number(item.id), JSON.stringify(item.metadata), item.fileUri, item.thumbnailUri || null,
    item.lyrics ? JSON.stringify(item.lyrics) : null, item.fileVersion, Number(item.byteSize),
    item.status || "ready", item.downloadedAt || new Date().toISOString()
  );
}

export async function updateStoredDownloadStatus(mediaId, status) {
  const database = await getOfflineDatabase();
  await database.runAsync("UPDATE downloads SET status = ? WHERE media_id = ?", status, Number(mediaId));
}

export async function deleteStoredDownload(mediaId) {
  const database = await getOfflineDatabase();
  await database.runAsync("DELETE FROM downloads WHERE media_id = ?", Number(mediaId));
}

export async function clearStoredDownloads() {
  const database = await getOfflineDatabase();
  await database.execAsync("DELETE FROM downloads; DELETE FROM download_jobs;");
}

export async function listStoredJobs() {
  const database = await getOfflineDatabase();
  const rows = await database.getAllAsync("SELECT * FROM download_jobs ORDER BY updated_at DESC");
  return rows.map((row) => ({
    mediaId: Number(row.media_id), batchId: row.batch_id, metadata: parseJson(row.metadata_json, {}),
    state: row.state, progress: Number(row.progress), error: row.error,
    cellularApproved: Boolean(row.cellular_approved), updatedAt: row.updated_at,
  }));
}

export async function saveStoredJob(job) {
  const database = await getOfflineDatabase();
  await database.runAsync(
    `INSERT INTO download_jobs (media_id, batch_id, metadata_json, state, progress, error, cellular_approved, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(media_id) DO UPDATE SET batch_id = excluded.batch_id, metadata_json = excluded.metadata_json,
       state = excluded.state, progress = excluded.progress, error = excluded.error,
       cellular_approved = excluded.cellular_approved, updated_at = excluded.updated_at`,
    Number(job.mediaId), job.batchId, JSON.stringify(job.metadata), job.state, Number(job.progress || 0),
    job.error || null, job.cellularApproved ? 1 : 0, new Date().toISOString()
  );
}

export async function patchStoredJob(mediaId, patch) {
  const database = await getOfflineDatabase();
  const current = await database.getFirstAsync("SELECT * FROM download_jobs WHERE media_id = ?", Number(mediaId));
  if (!current) return;
  await database.runAsync(
    "UPDATE download_jobs SET state = ?, progress = ?, error = ?, updated_at = ? WHERE media_id = ?",
    patch.state ?? current.state, patch.progress ?? current.progress, patch.error === undefined ? current.error : patch.error,
    new Date().toISOString(), Number(mediaId)
  );
}

export async function deleteStoredJob(mediaId) {
  const database = await getOfflineDatabase();
  await database.runAsync("DELETE FROM download_jobs WHERE media_id = ?", Number(mediaId));
}

export async function queuePlaybackEvent(payload) {
  const database = await getOfflineDatabase();
  const clientEventId = createClientEventId();
  await database.runAsync(
    "INSERT INTO playback_outbox (client_event_id, payload_json, created_at) VALUES (?, ?, ?)",
    clientEventId, JSON.stringify({ ...payload, clientEventId, occurredAt: new Date().toISOString() }), new Date().toISOString()
  );
}

export async function listPlaybackOutbox() {
  const database = await getOfflineDatabase();
  const rows = await database.getAllAsync("SELECT client_event_id, payload_json FROM playback_outbox ORDER BY created_at LIMIT 500");
  return rows.map((row) => parseJson(row.payload_json, {}));
}

export async function deletePlaybackOutbox(ids) {
  if (!ids?.length) return;
  const database = await getOfflineDatabase();
  const placeholders = ids.map(() => "?").join(",");
  await database.runAsync(`DELETE FROM playback_outbox WHERE client_event_id IN (${placeholders})`, ...ids);
}

export async function saveLocalResume(mediaId, position, duration) {
  const database = await getOfflineDatabase();
  const updatedAt = new Date().toISOString();
  await database.runAsync(
    `INSERT INTO local_resumes (media_id, position, duration, updated_at, dirty) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(media_id) DO UPDATE SET position = excluded.position, duration = excluded.duration,
       updated_at = excluded.updated_at, dirty = 1`,
    Number(mediaId), Math.max(0, Math.floor(position || 0)), Math.max(0, Math.floor(duration || 0)), updatedAt
  );
  return { mediaId: Number(mediaId), position, duration, updatedAt };
}

export async function getLocalResume(mediaId) {
  const database = await getOfflineDatabase();
  const row = await database.getFirstAsync("SELECT * FROM local_resumes WHERE media_id = ?", Number(mediaId));
  return row ? { mediaId: Number(row.media_id), position: row.position, duration: row.duration, updatedAt: row.updated_at } : null;
}

export async function listDirtyResumes() {
  const database = await getOfflineDatabase();
  const rows = await database.getAllAsync("SELECT * FROM local_resumes WHERE dirty = 1 LIMIT 500");
  return rows.map((row) => ({ mediaId: Number(row.media_id), position: row.position, duration: row.duration, updatedAt: row.updated_at }));
}

export async function markResumesSynced(ids) {
  if (!ids?.length) return;
  const database = await getOfflineDatabase();
  const placeholders = ids.map(() => "?").join(",");
  await database.runAsync(`UPDATE local_resumes SET dirty = 0 WHERE media_id IN (${placeholders})`, ...ids.map(Number));
}
