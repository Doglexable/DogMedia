import { describe, expect, it } from "vitest";
import {
  conflictDetailText,
  conflictDisplayText,
  conflictFromError,
  isHolderConflict,
  normalizeHolderSession,
} from "./exclusive-session";

describe("normalizeHolderSession", () => {
  it("normalizes complete, partial, and malformed payloads", () => {
    expect(normalizeHolderSession({
      platform: "desktop",
      deviceLabel: "Studio PC",
      mediaId: 42,
      expiresIn: 24,
    })).toEqual({ platform: "desktop", deviceLabel: "Studio PC", mediaId: 42 });
    expect(normalizeHolderSession({})).toEqual({
      platform: "unknown",
      deviceLabel: "Another device",
    });
    expect(normalizeHolderSession(null)).toBeNull();
    expect(normalizeHolderSession({
      platform: "mobile",
      deviceLabel: `  Living\u0000   Room ${"x".repeat(80)}  `,
      mediaId: "42",
      expiresIn: -1,
    })).toEqual({
      platform: "mobile",
      deviceLabel: `Living Room ${"x".repeat(52)}`,
    });
    expect(normalizeHolderSession({
      platform: "web",
      mediaId: 42,
      playback: { mediaId: 42, action: "pause", position: 12, duration: 90 },
    })).toMatchObject({
      playback: { mediaId: 42, action: "pause", position: 12, duration: 90 },
    });
  });

  it("derives conflicts from coded errors carrying response data", () => {
    expect(isHolderConflict({ code: "PLAYBACK_IN_USE" })).toBe(true);
    expect(isHolderConflict({ code: "PLAYBACK_NOT_OWNER" })).toBe(true);
    expect(isHolderConflict({ code: "OTHER" })).toBe(false);
    expect(conflictFromError({ code: "OTHER" })).toBeNull();
    expect(conflictFromError({
      code: "PLAYBACK_LEASE_LOST",
      message: "lost",
      retryAfter: 9,
      data: { activeSession: { platform: "web", deviceLabel: "Laptop", expiresIn: 9 } },
    })).toEqual({
      message: "lost",
      holder: { platform: "web", deviceLabel: "Laptop" },
    });
  });

  it("formats shared audio/video wording with safe fallbacks", () => {
    expect(conflictDetailText(null)).toBe("another device is playing this library");
    expect(conflictDisplayText(null, "fallback")).toBe("fallback");
    const text = conflictDisplayText({
      holder: { deviceLabel: "Studio PC", expiresIn: 24 },
    });
    expect(text).toContain("Studio PC is playing this library");
    expect(text).not.toContain("Available in about");
    expect(text).not.toContain("viewer");
  });
});
