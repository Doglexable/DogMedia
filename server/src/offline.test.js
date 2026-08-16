import { describe, expect, it } from "vitest";
import {
  buildOfflineFileVersion,
  isNewerOfflineResume,
  normalizeOfflineEvent,
  normalizeOfflineResume,
} from "./offline.js";

describe("offline synchronization helpers", () => {
  it("derives a stable version from file size and modification time", () => {
    expect(buildOfflineFileVersion({ size: 1234, mtimeMs: 5678.9 })).toBe("1234:5678");
  });

  it("normalizes valid playback events and rejects malformed identifiers", () => {
    expect(normalizeOfflineEvent({
      clientEventId: "123e4567-e89b-42d3-a456-426614174000",
      mediaId: "7",
      action: "play",
      position: 12.8,
      duration: 90,
      occurredAt: "2026-08-17T00:00:00.000Z",
    })).toMatchObject({ mediaId: 7, action: "play", position: 12 });
    expect(normalizeOfflineEvent({ clientEventId: "bad", mediaId: 7, action: "play" })).toBeNull();
  });

  it("normalizes resumes and resolves conflicts by timestamp", () => {
    const resume = normalizeOfflineResume({ mediaId: 3, position: 30, duration: 100, updatedAt: "2026-08-17T00:00:00Z" });
    expect(resume).toMatchObject({ mediaId: 3, position: 30, duration: 100 });
    expect(isNewerOfflineResume(resume.updatedAt, "2026-08-16T00:00:00Z")).toBe(true);
    expect(isNewerOfflineResume(resume.updatedAt, "2026-08-18T00:00:00Z")).toBe(false);
  });
});
