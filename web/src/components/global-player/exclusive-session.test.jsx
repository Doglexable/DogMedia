import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  conflictFromError,
  isHolderConflict,
  normalizeHolderSession,
  shouldHandleLeaseLoss,
} from "./exclusive-session";
import { holderPlatformIconName } from "./holder-platform-icon";

describe("normalizeHolderSession", () => {
  it("ignores lease loss from an old session while moving to the next track", () => {
    const oldSession = "old-session";
    const newSession = "new-session";
    const oldLeaseLost = { code: "PLAYBACK_LEASE_LOST", sessionId: oldSession };

    expect(shouldHandleLeaseLoss(oldLeaseLost, oldSession, oldSession)).toBe(false);
    expect(shouldHandleLeaseLoss(oldLeaseLost, newSession, null)).toBe(false);
    expect(shouldHandleLeaseLoss(oldLeaseLost, oldSession, null)).toBe(true);
    expect(shouldHandleLeaseLoss({ code: "PLAYBACK_LEASE_LOST", sessionId: newSession }, newSession, null)).toBe(true);
  });

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
    expect(normalizeHolderSession("nope")).toBeNull();
    expect(normalizeHolderSession({ platform: "tv", mediaId: -1 })).toMatchObject({
      platform: "unknown",
      deviceLabel: "Another device",
    });
    expect(normalizeHolderSession({
      platform: "web",
      deviceLabel: `  Living\u0000   Room ${"x".repeat(80)}  `,
      mediaId: "42",
      expiresIn: -1,
    })).toEqual({
      platform: "web",
      deviceLabel: `Living Room ${"x".repeat(52)}`,
    });
    expect(normalizeHolderSession({
      platform: "desktop",
      mediaId: 42,
      playback: { mediaId: 42, action: "play", position: 12, duration: 90, loopMode: "queue", shuffleEnabled: true },
    })).toMatchObject({
      playback: { mediaId: 42, action: "play", position: 12, duration: 90, loopMode: "queue", shuffleEnabled: true },
    });
  });

  it("derives holder conflicts from errors with codes", () => {
    expect(isHolderConflict({ code: "PLAYBACK_IN_USE" })).toBe(true);
    expect(isHolderConflict({ code: "PLAYBACK_LEASE_LOST" })).toBe(true);
    expect(isHolderConflict({ code: "PLAYBACK_NOT_OWNER" })).toBe(true);
    expect(isHolderConflict({ code: "NOPE" })).toBe(false);
    expect(conflictFromError({ code: "NOPE", message: "x" })).toBeNull();
    expect(conflictFromError({
      code: "PLAYBACK_IN_USE",
      message: "busy",
      retryAfter: 9,
      activeSession: { platform: "mobile", deviceLabel: "Phone", expiresIn: 9 },
    })).toEqual({
      message: "busy",
      holder: { platform: "mobile", deviceLabel: "Phone" },
    });
  });
});

describe("PlayerBar Spotify Connect Observer Bar", () => {
  it("renders Spotify connect green bar showing active device and takeover option", async () => {
    const { PlayerBar } = await import("./player-bar");
    const markup = renderToStaticMarkup(
      <PlayerBar
        currentMedia={{ id: 1, title: "Merayakan Luka", mime_type: "audio/flac" }}
        conflict={{
          holder: { platform: "mobile", deviceLabel: "iPhone" },
        }}
        canTakeOver
        onTakeOver={() => {}}
      />,
    );
    expect(markup).toContain("has-connect-bar");
    expect(markup).toContain("spotify-connect-bar");
    expect(markup).toContain("Playing on iPhone");
    expect(markup).toContain("Play here");
    expect(markup).not.toContain("Available in about");
  });

  it("maps holder platforms to lucide icons", () => {
    expect(holderPlatformIconName("desktop")).toBe("monitor");
    expect(holderPlatformIconName("mobile")).toBe("smartphone");
    expect(holderPlatformIconName("web")).toBe("globe");
    expect(holderPlatformIconName("unknown")).toBe("globe");
    expect(holderPlatformIconName(undefined)).toBe("globe");
  });

  it("renders the holder platform icon in the connect bar", async () => {
    const { PlayerBar } = await import("./player-bar");
    const renderBar = (platform) => renderToStaticMarkup(
      <PlayerBar
        currentMedia={{ id: 1, title: "Merayakan Luka", mime_type: "audio/flac" }}
        conflict={{ holder: { platform, deviceLabel: "Studio" } }}
      />,
    );
    expect(renderBar("desktop")).toContain('data-lucide="monitor"');
    expect(renderBar("mobile")).toContain('data-lucide="smartphone"');
    expect(renderBar("web")).toContain('data-lucide="globe"');
    expect(renderBar("unknown")).toContain('data-lucide="globe"');
  });
});
