import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";

let activeDb = null;

function createMockDb() {
  const syncDb = new DatabaseSync(":memory:");
  return {
    _rawDb: syncDb,
    execAsync: async (sql) => {
      syncDb.exec(sql);
    },
    runAsync: async (sql, ...params) => {
      return syncDb.prepare(sql).run(...params);
    },
    getFirstAsync: async (sql, ...params) => {
      const row = syncDb.prepare(sql).get(...params);
      return row ?? null;
    },
    getAllAsync: async (sql, ...params) => {
      return syncDb.prepare(sql).all(...params);
    },
    close: () => {
      try {
        syncDb.close();
      } catch {}
    },
  };
}

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn(async () => {
    if (!activeDb) {
      activeDb = createMockDb();
    }
    return activeDb;
  }),
}));

import {
  _resetOfflineDatabaseForTesting,
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
} from "./offline-store";

describe("mobile offline-store", () => {
  beforeEach(() => {
    if (activeDb) {
      activeDb.close();
      activeDb = null;
    }
    _resetOfflineDatabaseForTesting();
  });

  afterEach(() => {
    if (activeDb) {
      activeDb.close();
      activeDb = null;
    }
    _resetOfflineDatabaseForTesting();
  });

  describe("createClientEventId", () => {
    it("generates valid UUID v4 format", () => {
      const id = createClientEventId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it("falls back to pseudo-random generator when crypto.randomUUID is unavailable", () => {
      const originalCrypto = globalThis.crypto;
      try {
        delete globalThis.crypto;
        const id = createClientEventId();
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      } finally {
        globalThis.crypto = originalCrypto;
      }
    });
  });

  describe("lease management (offline_lease)", () => {
    it("returns null when no lease has been stored", async () => {
      const lease = await getStoredLease();
      expect(lease).toBeNull();
    });

    it("saves and retrieves a valid lease", async () => {
      const expiresAt = "2026-12-31T23:59:59.000Z";
      const validatedAt = "2026-09-22T00:00:00.000Z";

      await saveStoredLease({ expiresAt, locked: false, validatedAt });
      const lease = await getStoredLease();

      expect(lease).toEqual({
        expiresAt,
        locked: false,
        validatedAt,
      });
    });

    it("reads locked lease state correctly", async () => {
      const expiresAt = "2026-10-01T00:00:00.000Z";
      await saveStoredLease({ expiresAt, locked: true });

      const lease = await getStoredLease();
      expect(lease).not.toBeNull();
      expect(lease?.locked).toBe(true);
      expect(lease?.expiresAt).toBe(expiresAt);
      expect(typeof lease?.validatedAt).toBe("string");
    });

    it("updates existing lease on conflict (upsert on id=1)", async () => {
      await saveStoredLease({
        expiresAt: "2026-09-30T00:00:00.000Z",
        locked: true,
        validatedAt: "2026-09-20T00:00:00.000Z",
      });

      const updatedExpiresAt = "2026-11-15T00:00:00.000Z";
      const updatedValidatedAt = "2026-09-22T12:00:00.000Z";
      await saveStoredLease({
        expiresAt: updatedExpiresAt,
        locked: false,
        validatedAt: updatedValidatedAt,
      });

      const lease = await getStoredLease();
      expect(lease).toEqual({
        expiresAt: updatedExpiresAt,
        locked: false,
        validatedAt: updatedValidatedAt,
      });
    });

    it("enforces single-row constraint (id = 1)", async () => {
      const db = await getOfflineDatabase();
      await expect(
        db.runAsync("INSERT INTO offline_lease (id, expires_at, locked) VALUES (2, ?, 0)", "2026-12-31")
      ).rejects.toThrow();
    });
  });

  describe("downloads management (downloads)", () => {
    it("saves and lists stored downloads with full metadata and lyrics", async () => {
      const downloadItem = {
        id: 101,
        metadata: { title: "Track Alpha", artist: "Artist One", album: "Debut" },
        fileUri: "file:///offline/audio/101.mp3",
        thumbnailUri: "file:///offline/thumbnails/101.jpg",
        lyrics: { lines: [{ text: "First line", startTimeMs: 1000 }] },
        fileVersion: "v1.0",
        byteSize: 5242880,
        status: "ready",
        downloadedAt: "2026-09-22T02:00:00.000Z",
      };

      await saveStoredDownload(downloadItem);
      const downloads = await listStoredDownloads();

      expect(downloads).toHaveLength(1);
      expect(downloads[0]).toEqual({
        mediaId: 101,
        title: "Track Alpha",
        artist: "Artist One",
        album: "Debut",
        fileUri: "file:///offline/audio/101.mp3",
        thumbnailUri: "file:///offline/thumbnails/101.jpg",
        lyrics: { lines: [{ text: "First line", startTimeMs: 1000 }] },
        fileVersion: "v1.0",
        byteSize: 5242880,
        status: "ready",
        downloadedAt: "2026-09-22T02:00:00.000Z",
      });
    });

    it("orders downloads by downloaded_at descending", async () => {
      await saveStoredDownload({
        id: 1,
        metadata: { title: "Older" },
        fileUri: "file:///1.mp3",
        fileVersion: "v1",
        byteSize: 1000,
        downloadedAt: "2026-09-20T00:00:00.000Z",
      });
      await saveStoredDownload({
        id: 2,
        metadata: { title: "Newer" },
        fileUri: "file:///2.mp3",
        fileVersion: "v1",
        byteSize: 2000,
        downloadedAt: "2026-09-22T00:00:00.000Z",
      });

      const list = await listStoredDownloads();
      expect(list.map((d) => d.mediaId)).toEqual([2, 1]);
    });

    it("updates existing download on conflict", async () => {
      await saveStoredDownload({
        id: 101,
        metadata: { title: "Original" },
        fileUri: "file:///old.mp3",
        fileVersion: "v1.0",
        byteSize: 1000,
      });

      await saveStoredDownload({
        id: 101,
        metadata: { title: "Updated" },
        fileUri: "file:///new.mp3",
        fileVersion: "v2.0",
        byteSize: 2000,
        status: "ready",
      });

      const downloads = await listStoredDownloads();
      expect(downloads).toHaveLength(1);
      expect(downloads[0].title).toBe("Updated");
      expect(downloads[0].fileUri).toBe("file:///new.mp3");
      expect(downloads[0].fileVersion).toBe("v2.0");
      expect(downloads[0].byteSize).toBe(2000);
    });

    it("updates stored download status", async () => {
      await saveStoredDownload({
        id: 101,
        metadata: { title: "Track" },
        fileUri: "file:///101.mp3",
        fileVersion: "v1",
        byteSize: 1000,
        status: "ready",
      });

      await updateStoredDownloadStatus(101, "archived");
      const downloads = await listStoredDownloads();
      expect(downloads[0].status).toBe("archived");
    });

    it("deletes stored download by mediaId", async () => {
      await saveStoredDownload({
        id: 101,
        metadata: { title: "Track 1" },
        fileUri: "file:///101.mp3",
        fileVersion: "v1",
        byteSize: 1000,
      });
      await saveStoredDownload({
        id: 102,
        metadata: { title: "Track 2" },
        fileUri: "file:///102.mp3",
        fileVersion: "v1",
        byteSize: 1000,
      });

      await deleteStoredDownload(101);
      const remaining = await listStoredDownloads();
      expect(remaining.map((d) => d.mediaId)).toEqual([102]);
    });

    it("clears all stored downloads and jobs together", async () => {
      await saveStoredDownload({
        id: 101,
        metadata: { title: "Track" },
        fileUri: "file:///101.mp3",
        fileVersion: "v1",
        byteSize: 1000,
      });
      await saveStoredJob({
        mediaId: 101,
        batchId: "batch-1",
        metadata: { title: "Track" },
        state: "completed",
        progress: 1.0,
      });

      await clearStoredDownloads();
      expect(await listStoredDownloads()).toEqual([]);
      expect(await listStoredJobs()).toEqual([]);
    });

    it("handles corrupted JSON metadata gracefully", async () => {
      const db = await getOfflineDatabase();
      await db.runAsync(
        "INSERT INTO downloads (media_id, metadata_json, file_uri, lyrics_json, file_version, byte_size, downloaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        999,
        "{invalid-json",
        "file:///corrupt.mp3",
        "{invalid-lyrics",
        "v1",
        500,
        "2026-09-22T00:00:00.000Z"
      );

      const downloads = await listStoredDownloads();
      expect(downloads).toHaveLength(1);
      expect(downloads[0].mediaId).toBe(999);
      expect(downloads[0].lyrics).toBeNull();
    });
  });

  describe("download jobs (download_jobs)", () => {
    it("saves and lists download jobs with cellular approval flag", async () => {
      const job = {
        mediaId: 201,
        batchId: "batch-xyz",
        metadata: { title: "Queued Track" },
        state: "queued",
        progress: 0,
        cellularApproved: true,
      };

      await saveStoredJob(job);
      const jobs = await listStoredJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        mediaId: 201,
        batchId: "batch-xyz",
        metadata: { title: "Queued Track" },
        state: "queued",
        progress: 0,
        error: null,
        cellularApproved: true,
      });
      expect(typeof jobs[0].updatedAt).toBe("string");
    });

    it("updates existing job on conflict", async () => {
      await saveStoredJob({
        mediaId: 201,
        batchId: "batch-1",
        metadata: { title: "Track" },
        state: "queued",
        progress: 0,
      });

      await saveStoredJob({
        mediaId: 201,
        batchId: "batch-2",
        metadata: { title: "Track Updated" },
        state: "downloading",
        progress: 0.25,
        error: null,
        cellularApproved: true,
      });

      const jobs = await listStoredJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].batchId).toBe("batch-2");
      expect(jobs[0].state).toBe("downloading");
      expect(jobs[0].progress).toBe(0.25);
      expect(jobs[0].cellularApproved).toBe(true);
    });

    it("patches existing download job state, progress, and error", async () => {
      await saveStoredJob({
        mediaId: 201,
        batchId: "batch-1",
        metadata: { title: "Track" },
        state: "queued",
        progress: 0,
      });

      await patchStoredJob(201, { state: "downloading", progress: 0.6 });
      let jobs = await listStoredJobs();
      expect(jobs[0].state).toBe("downloading");
      expect(jobs[0].progress).toBe(0.6);
      expect(jobs[0].error).toBeNull();

      await patchStoredJob(201, { state: "failed", error: "Connection reset by peer" });
      jobs = await listStoredJobs();
      expect(jobs[0].state).toBe("failed");
      expect(jobs[0].progress).toBe(0.6);
      expect(jobs[0].error).toBe("Connection reset by peer");
    });

    it("silently ignores patch on non-existent job", async () => {
      await patchStoredJob(999, { state: "downloading", progress: 0.5 });
      const jobs = await listStoredJobs();
      expect(jobs).toEqual([]);
    });

    it("deletes stored download job by mediaId", async () => {
      await saveStoredJob({
        mediaId: 201,
        batchId: "batch-1",
        metadata: {},
        state: "queued",
      });
      await saveStoredJob({
        mediaId: 202,
        batchId: "batch-1",
        metadata: {},
        state: "queued",
      });

      await deleteStoredJob(201);
      const jobs = await listStoredJobs();
      expect(jobs.map((j) => j.mediaId)).toEqual([202]);
    });

    it("recovers interrupted downloading jobs to paused on startup", async () => {
      // 1. Initialize database and add jobs in various states
      await saveStoredJob({
        mediaId: 301,
        batchId: "batch-active",
        metadata: { title: "Interrupted Song" },
        state: "downloading",
        progress: 0.45,
      });
      await saveStoredJob({
        mediaId: 302,
        batchId: "batch-active",
        metadata: { title: "Queued Song" },
        state: "queued",
        progress: 0,
      });
      await saveStoredJob({
        mediaId: 303,
        batchId: "batch-active",
        metadata: { title: "Completed Song" },
        state: "completed",
        progress: 1.0,
      });

      // 2. Simulate app restart: reset memory cache but retain underlying SQLite database
      _resetOfflineDatabaseForTesting();

      // 3. Next getOfflineDatabase() runs startup recovery query:
      // UPDATE download_jobs SET state = "paused", error = "Download interrupted" WHERE state = "downloading"
      await getOfflineDatabase();

      const jobs = await listStoredJobs();
      const interruptedJob = jobs.find((j) => j.mediaId === 301);
      const queuedJob = jobs.find((j) => j.mediaId === 302);
      const completedJob = jobs.find((j) => j.mediaId === 303);

      expect(interruptedJob?.state).toBe("paused");
      expect(interruptedJob?.error).toBe("Download interrupted");
      expect(interruptedJob?.progress).toBe(0.45);

      expect(queuedJob?.state).toBe("queued");
      expect(queuedJob?.error).toBeNull();

      expect(completedJob?.state).toBe("completed");
      expect(completedJob?.error).toBeNull();
    });
  });

  describe("playback outbox (playback_outbox)", () => {
    it("enqueues playback events and generates clientEventId and occurredAt", async () => {
      await queuePlaybackEvent({ mediaId: 401, action: "start", positionMs: 0 });

      const outbox = await listPlaybackOutbox();
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({
        mediaId: 401,
        action: "start",
        positionMs: 0,
      });
      expect(typeof outbox[0].clientEventId).toBe("string");
      expect(typeof outbox[0].occurredAt).toBe("string");
    });

    it("maintains FIFO ordering based on created_at", async () => {
      const db = await getOfflineDatabase();
      // Insert explicitly timestamped events to guarantee FIFO order
      await db.runAsync(
        "INSERT INTO playback_outbox (client_event_id, payload_json, created_at) VALUES (?, ?, ?)",
        "evt-first",
        JSON.stringify({ seq: 1 }),
        "2026-09-22T01:00:00.000Z"
      );
      await db.runAsync(
        "INSERT INTO playback_outbox (client_event_id, payload_json, created_at) VALUES (?, ?, ?)",
        "evt-second",
        JSON.stringify({ seq: 2 }),
        "2026-09-22T02:00:00.000Z"
      );
      await db.runAsync(
        "INSERT INTO playback_outbox (client_event_id, payload_json, created_at) VALUES (?, ?, ?)",
        "evt-third",
        JSON.stringify({ seq: 3 }),
        "2026-09-22T03:00:00.000Z"
      );

      const outbox = await listPlaybackOutbox();
      expect(outbox.map((e) => e.seq)).toEqual([1, 2, 3]);
    });

    it("batch deletes synced playback event IDs", async () => {
      const db = await getOfflineDatabase();
      await db.runAsync(
        "INSERT INTO playback_outbox (client_event_id, payload_json, created_at) VALUES (?, ?, ?)",
        "evt-1",
        JSON.stringify({ id: "evt-1" }),
        "2026-09-22T01:00:00.000Z"
      );
      await db.runAsync(
        "INSERT INTO playback_outbox (client_event_id, payload_json, created_at) VALUES (?, ?, ?)",
        "evt-2",
        JSON.stringify({ id: "evt-2" }),
        "2026-09-22T02:00:00.000Z"
      );
      await db.runAsync(
        "INSERT INTO playback_outbox (client_event_id, payload_json, created_at) VALUES (?, ?, ?)",
        "evt-3",
        JSON.stringify({ id: "evt-3" }),
        "2026-09-22T03:00:00.000Z"
      );

      await deletePlaybackOutbox(["evt-1", "evt-3"]);
      const outbox = await listPlaybackOutbox();

      expect(outbox).toHaveLength(1);
      expect(outbox[0].id).toBe("evt-2");
    });

    it("does nothing when deletePlaybackOutbox is called with empty or null list", async () => {
      await queuePlaybackEvent({ mediaId: 401 });
      await deletePlaybackOutbox([]);
      await deletePlaybackOutbox(null);
      await deletePlaybackOutbox(undefined);

      const outbox = await listPlaybackOutbox();
      expect(outbox).toHaveLength(1);
    });
  });

  describe("local resumes (local_resumes)", () => {
    it("saves and retrieves a local resume with rounded positions", async () => {
      const result = await saveLocalResume(501, 142.8, 300.9);
      expect(result).toMatchObject({
        mediaId: 501,
        position: 142.8,
        duration: 300.9,
      });

      const stored = await getLocalResume(501);
      expect(stored).toMatchObject({
        mediaId: 501,
        position: 142,
        duration: 300,
      });
      expect(typeof stored?.updatedAt).toBe("string");
    });

    it("returns null for non-existent media resume", async () => {
      const stored = await getLocalResume(999);
      expect(stored).toBeNull();
    });

    it("tracks dirty flag and lists only dirty resumes", async () => {
      await saveLocalResume(501, 30, 100);
      await saveLocalResume(502, 60, 200);

      const dirty = await listDirtyResumes();
      expect(dirty).toHaveLength(2);
      expect(dirty.map((r) => r.mediaId).sort()).toEqual([501, 502]);
    });

    it("marks resumes synced by setting dirty = 0", async () => {
      await saveLocalResume(501, 30, 100);
      await saveLocalResume(502, 60, 200);

      await markResumesSynced([501]);

      const dirty = await listDirtyResumes();
      expect(dirty).toHaveLength(1);
      expect(dirty[0].mediaId).toBe(502);

      // Verify resume data still exists, just not dirty
      const stored = await getLocalResume(501);
      expect(stored?.position).toBe(30);
    });

    it("marks resume dirty again when updated after sync", async () => {
      await saveLocalResume(501, 30, 100);
      await markResumesSynced([501]);
      expect(await listDirtyResumes()).toEqual([]);

      // Update position on the synced item
      await saveLocalResume(501, 45, 100);

      const dirty = await listDirtyResumes();
      expect(dirty).toHaveLength(1);
      expect(dirty[0]).toMatchObject({
        mediaId: 501,
        position: 45,
        duration: 100,
      });
    });

    it("does nothing when markResumesSynced is called with empty or null list", async () => {
      await saveLocalResume(501, 30, 100);
      await markResumesSynced([]);
      await markResumesSynced(null);
      await markResumesSynced(undefined);

      const dirty = await listDirtyResumes();
      expect(dirty).toHaveLength(1);
    });
  });
});
