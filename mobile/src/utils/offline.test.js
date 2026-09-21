import { describe, expect, it, vi } from "vitest";
import {
  evaluateOfflineLease,
  filterPlayableOfflineQueue,
  getDownloadNetworkPolicy,
  hasDownloadDiskSpace,
  nextDownloadState,
  resolveOfflineSource,
  shouldReplaceResume,
} from "./offline";

describe("offline mode policies", () => {
  it("allows an unexpired lease and rejects expired or explicitly locked leases", () => {
    expect(evaluateOfflineLease({ expiresAt: "2026-09-01T00:00:00Z" }, Date.parse("2026-08-01T00:00:00Z")).playable).toBe(true);
    expect(evaluateOfflineLease({ expiresAt: "2026-07-01T00:00:00Z" }, Date.parse("2026-08-01T00:00:00Z")).state).toBe("expired");
    expect(evaluateOfflineLease({ locked: true, expiresAt: "2027-01-01T00:00:00Z" }).state).toBe("locked");
  });

  it("requires explicit cellular approval and rejects unavailable networks", () => {
    expect(getDownloadNetworkPolicy({ isConnected: false, type: "wifi" })).toBe("offline");
    expect(getDownloadNetworkPolicy({ isConnected: true, type: "cellular" })).toBe("cellular-approval");
    expect(getDownloadNetworkPolicy({ isConnected: true, type: "cellular", cellularApproved: true })).toBe("allowed");
  });

  it("enforces disk reserve and deterministic download transitions", () => {
    expect(hasDownloadDiskSpace(200, 100, 50)).toBe(true);
    expect(hasDownloadDiskSpace(120, 100, 50)).toBe(false);
    expect(nextDownloadState("queued", "start")).toBe("downloading");
    expect(nextDownloadState("downloading", "fail")).toBe("failed");
  });

  it("resolves only valid ready files and filters local queues", () => {
    const lease = { expiresAt: "2999-01-01T00:00:00Z" };
    const downloads = new Map([[2, { status: "ready", fileUri: "file:///two.mp3" }]]);
    expect(resolveOfflineSource(2, downloads, lease)).toBe("file:///two.mp3");
    expect(resolveOfflineSource(3, downloads, lease)).toBeNull();
    expect(filterPlayableOfflineQueue([{ id: 1 }, { id: 2 }], new Set([2]))).toEqual([{ id: 2 }]);
  });

  it("uses the newest resume timestamp", () => {
    expect(shouldReplaceResume({ updatedAt: "2026-08-02" }, { updatedAt: "2026-08-01" })).toBe(true);
    expect(shouldReplaceResume({ updatedAt: "2026-08-01" }, { updatedAt: "2026-08-02" })).toBe(false);
  });
});

const { runQueries, mockDatabase } = vi.hoisted(() => {
  const runQueries = [];
  const mockDatabase = {
    execAsync: vi.fn().mockResolvedValue(undefined),
    runAsync: vi.fn(async (sql, ...params) => {
      runQueries.push({ sql, params });
    }),
    getAllAsync: vi.fn().mockResolvedValue([]),
    getFirstAsync: vi.fn().mockResolvedValue(null),
  };
  return { runQueries, mockDatabase };
});

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn().mockResolvedValue(mockDatabase),
}));

import { deletePlaybackOutbox, markResumesSynced } from "../offline-store";

describe("offline sync eviction", () => {
  it("purges both accepted and rejected event IDs from playback outbox", async () => {
    runQueries.length = 0;
    const syncResult = {
      acceptedEventIds: ["evt-accepted-1"],
      rejectedEventIds: ["evt-rejected-deleted-media-2"],
      acceptedResumeIds: [10],
      rejectedResumeIds: [999],
    };

    const eventsToDelete = [...(syncResult.acceptedEventIds || []), ...(syncResult.rejectedEventIds || [])];
    const resumesToClear = [...(syncResult.acceptedResumeIds || []), ...(syncResult.rejectedResumeIds || [])];

    await Promise.all([
      deletePlaybackOutbox(eventsToDelete),
      markResumesSynced(resumesToClear),
    ]);

    const deleteCall = runQueries.find((q) => q.sql.includes("DELETE FROM playback_outbox"));
    expect(deleteCall).toBeDefined();
    expect(deleteCall.sql).toContain("client_event_id IN (?,?)");
    expect(deleteCall.params).toEqual(["evt-accepted-1", "evt-rejected-deleted-media-2"]);

    const resumeCall = runQueries.find((q) => q.sql.includes("UPDATE local_resumes SET dirty = 0"));
    expect(resumeCall).toBeDefined();
    expect(resumeCall.sql).toContain("media_id IN (?,?)");
    expect(resumeCall.params).toEqual([10, 999]);
  });

  it("evicts rejected events when all pending sync events are rejected for deleted media", async () => {
    runQueries.length = 0;
    const syncResult = {
      acceptedEventIds: [],
      rejectedEventIds: ["evt-rejected-deleted-1", "evt-rejected-deleted-2"],
    };

    const eventsToDelete = [...(syncResult.acceptedEventIds || []), ...(syncResult.rejectedEventIds || [])];
    await deletePlaybackOutbox(eventsToDelete);

    const deleteCall = runQueries.find((q) => q.sql.includes("DELETE FROM playback_outbox"));
    expect(deleteCall).toBeDefined();
    expect(deleteCall.params).toEqual(["evt-rejected-deleted-1", "evt-rejected-deleted-2"]);
  });

  it("does not execute queries when accepted and rejected lists are empty", async () => {
    runQueries.length = 0;
    const syncResult = { acceptedEventIds: [], rejectedEventIds: [], acceptedResumeIds: [], rejectedResumeIds: [] };
    const eventsToDelete = [...(syncResult.acceptedEventIds || []), ...(syncResult.rejectedEventIds || [])];
    const resumesToClear = [...(syncResult.acceptedResumeIds || []), ...(syncResult.rejectedResumeIds || [])];

    await Promise.all([
      deletePlaybackOutbox(eventsToDelete),
      markResumesSynced(resumesToClear),
    ]);

    expect(runQueries).toHaveLength(0);
  });
});
