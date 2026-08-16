import { describe, expect, it } from "vitest";
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
