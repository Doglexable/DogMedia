import { describe, expect, it, vi } from "vitest";
import {
  getMediaSessionMetadata,
  registerMediaSessionActionHandlers,
} from "./media-session";

describe("getMediaSessionMetadata", () => {
  it("uses the media thumbnail and audio metadata", () => {
    expect(getMediaSessionMetadata({
      id: 42,
      title: "  Night Drive  ",
      artists: "The Dogs",
      category_path: "Music/Road Songs",
    }, {
      isAudio: true,
      mediaLabel: "Audio",
      origin: "https://media.example.test",
    })).toEqual({
      title: "Night Drive",
      artist: "The Dogs",
      album: "Music/Road Songs",
      artwork: [{ src: "https://media.example.test/api/media/42/thumbnail" }],
    });
  });

  it("updates artwork for a different active media item", () => {
    const options = {
      isAudio: false,
      mediaLabel: "Video",
      origin: "https://media.example.test",
    };

    expect(getMediaSessionMetadata({ id: 7, title: "One" }, options).artwork[0].src)
      .toBe("https://media.example.test/api/media/7/thumbnail");
    expect(getMediaSessionMetadata({ id: 8, title: "Two" }, options).artwork[0].src)
      .toBe("https://media.example.test/api/media/8/thumbnail");
  });

  it("provides safe title, artist, album, and artwork fallbacks", () => {
    expect(getMediaSessionMetadata({ title: "", artists: "Unknown Artist" }, {
      isAudio: true,
      mediaLabel: "Audio",
      origin: "https://media.example.test",
    })).toEqual({
      title: "Untitled",
      artist: "",
      album: "Library",
      artwork: [],
    });
  });
});

describe("registerMediaSessionActionHandlers", () => {
  function createMediaSession() {
    const registered = new Map();
    return {
      registered,
      setActionHandler: vi.fn((action, handler) => registered.set(action, handler)),
    };
  }

  it("keeps registered actions stable while their latest callbacks change", () => {
    const mediaSession = createMediaSession();
    const firstPrevious = vi.fn();
    const latestPrevious = vi.fn();
    const handlersRef = { current: { previoustrack: firstPrevious } };

    registerMediaSessionActionHandlers(mediaSession, handlersRef, {
      canGoPrev: true,
      canGoNext: true,
    });
    const registrationCount = mediaSession.setActionHandler.mock.calls.length;

    handlersRef.current = { previoustrack: latestPrevious };
    mediaSession.registered.get("previoustrack")();

    expect(firstPrevious).not.toHaveBeenCalled();
    expect(latestPrevious).toHaveBeenCalledOnce();
    expect(mediaSession.setActionHandler).toHaveBeenCalledTimes(registrationCount);
  });

  it("exposes previous and next only when queue navigation is available", () => {
    const unavailableSession = createMediaSession();
    registerMediaSessionActionHandlers(unavailableSession, { current: {} }, {
      canGoPrev: false,
      canGoNext: false,
    });

    expect(unavailableSession.registered.get("previoustrack")).toBeNull();
    expect(unavailableSession.registered.get("nexttrack")).toBeNull();

    const availableSession = createMediaSession();
    registerMediaSessionActionHandlers(availableSession, { current: {} }, {
      canGoPrev: true,
      canGoNext: true,
    });

    expect(availableSession.registered.get("previoustrack")).toBeTypeOf("function");
    expect(availableSession.registered.get("nexttrack")).toBeTypeOf("function");
  });

  it("clears every notification action during cleanup", () => {
    const mediaSession = createMediaSession();
    const cleanup = registerMediaSessionActionHandlers(mediaSession, { current: {} }, {
      canGoPrev: true,
      canGoNext: true,
    });

    cleanup();

    expect([...mediaSession.registered.values()].every((handler) => handler === null)).toBe(true);
  });
});
