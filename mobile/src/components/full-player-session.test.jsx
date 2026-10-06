import { afterEach, describe, expect, it, vi } from "vitest";

const { createPlaybackSessionSource, releasePlaybackLease } = vi.hoisted(() => ({
  createPlaybackSessionSource: vi.fn(),
  releasePlaybackLease: vi.fn(),
}));

vi.mock("../api", () => ({ createPlaybackSessionSource, releasePlaybackLease }));
vi.mock("expo-video", () => ({ useVideoPlayer: vi.fn(), VideoView: vi.fn() }));
vi.mock("expo", () => ({ useEventListener: vi.fn() }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: vi.fn() }));
vi.mock("@gorhom/bottom-sheet", () => ({ BottomSheetBackdrop: vi.fn(), BottomSheetFlatList: vi.fn(), BottomSheetModal: vi.fn() }));
vi.mock("react-native-draggable-flatlist", () => ({ default: vi.fn(), ScaleDecorator: vi.fn() }));
vi.mock("react-native", () => ({
  ActivityIndicator: vi.fn(), Alert: {}, Image: vi.fn(), Pressable: vi.fn(), Share: {},
  StyleSheet: { create: (styles) => styles }, Text: vi.fn(), useWindowDimensions: vi.fn(), View: vi.fn(),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: vi.fn() }));
vi.mock("../theme", () => ({ alpha: vi.fn(), radii: {}, spacing: {}, useTheme: vi.fn() }));
vi.mock("../utils/media", () => ({ formatDuration: vi.fn(), getQueueItemSubtitle: vi.fn(), resolveMediaArtist: vi.fn() }));
vi.mock("../utils/exclusive-session", () => ({ conflictDisplayText: vi.fn(), conflictFromError: vi.fn() }));
vi.mock("../context/player-context", () => ({ usePlayer: vi.fn() }));
vi.mock("../context/offline-context", () => ({ useOffline: vi.fn() }));
vi.mock("./lyrics-view", () => ({ LyricsView: vi.fn() }));
vi.mock("./player-controls", () => ({ PlayerIconButton: vi.fn(), PlayerTransportControls: vi.fn() }));

import { requestProtectedSource } from "./full-player";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("protected video source request", () => {
  it("delivers a source while active without releasing its lease", async () => {
    const request = deferred();
    const source = { sessionId: "active", leaseRequired: true };
    const onSource = vi.fn();
    createPlaybackSessionSource.mockReturnValueOnce(request.promise);

    requestProtectedSource(1, "med", onSource, vi.fn());
    request.resolve(source);
    await request.promise;

    expect(createPlaybackSessionSource).toHaveBeenCalledWith(1, "med");
    expect(onSource).toHaveBeenCalledExactlyOnceWith(source);
    expect(releasePlaybackLease).not.toHaveBeenCalled();
  });

  it("releases a source exactly once if the effect cleans up before resolution", async () => {
    const request = deferred();
    const source = { sessionId: "abandoned", leaseRequired: true };
    const onSource = vi.fn();
    createPlaybackSessionSource.mockReturnValueOnce(request.promise);

    const cleanup = requestProtectedSource(1, "med", onSource, vi.fn());
    cleanup();
    cleanup();
    request.resolve(source);
    await request.promise;

    expect(onSource).not.toHaveBeenCalled();
    expect(releasePlaybackLease).toHaveBeenCalledExactlyOnceWith(source);
  });

  it("ignores a rejection after cleanup", async () => {
    const request = deferred();
    const onSource = vi.fn();
    const onError = vi.fn();
    createPlaybackSessionSource.mockReturnValueOnce(request.promise);

    requestProtectedSource(1, "med", onSource, onError)();
    request.reject(new Error("network failed"));
    await expect(request.promise).rejects.toThrow("network failed");
    await Promise.resolve();

    expect(onSource).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(releasePlaybackLease).not.toHaveBeenCalled();
  });

  it("releases only stale media A when media B replaces it", async () => {
    const requestA = deferred();
    const requestB = deferred();
    const sourceA = { sessionId: "A", leaseRequired: true };
    const sourceB = { sessionId: "B", leaseRequired: true };
    const onSource = vi.fn();
    createPlaybackSessionSource.mockReturnValueOnce(requestA.promise).mockReturnValueOnce(requestB.promise);

    const cleanupA = requestProtectedSource(1, "med", onSource, vi.fn());
    cleanupA();
    requestProtectedSource(2, "high", onSource, vi.fn());
    requestB.resolve(sourceB);
    await requestB.promise;
    requestA.resolve(sourceA);
    await requestA.promise;

    expect(onSource).toHaveBeenCalledExactlyOnceWith(sourceB);
    expect(releasePlaybackLease).toHaveBeenCalledExactlyOnceWith(sourceA);
  });
});
