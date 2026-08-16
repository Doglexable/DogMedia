import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiJson, mediaStreamUrl } from "../api";
import { SleepTimerCompleteModal } from "../components/sleep-timer-complete-modal";
import { useOffline } from "./offline-context";
import { getMediaKind, nextLoopMode } from "../utils/media";
import {
  getCompletionAction,
  getQueueNavigation,
  isValidResumePosition,
  normalizeQueueState,
} from "../utils/player-state";

const PlayerContext = createContext(null);
const PROGRESS_SYNC_SECONDS = 10;
const SLEEP_TIMER_MAX_MINUTES = 60;

export function usePlayer() {
  return useContext(PlayerContext);
}

export function PlayerProvider({ children }) {
  const offline = useOffline();
  const soundRef = useRef(null);
  const soundSubscriptionRef = useRef(null);
  const videoControllerRef = useRef(null);
  const currentMediaRef = useRef(null);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const pausedRef = useRef(true);
  const volumeRef = useRef(0.85);
  const mutedRef = useRef(false);
  const loopModeRef = useRef("none");
  const shuffleEnabledRef = useRef(false);
  const queueIdsRef = useRef([]);
  const queueIndexRef = useRef(0);
  const queueItemsRef = useRef([]);
  const queueModeRef = useRef("server");
  const pendingStartPositionRef = useRef(null);
  const awaitingAutoplayRef = useRef(null);
  const completedMediaRef = useRef(null);
  const lastResumeSaveRef = useRef(0);
  const lastActiveUpdateRef = useRef(0);
  const resumeLoadSequenceRef = useRef(0);
  const activeRestoreStartedRef = useRef(false);
  const handleEndedRef = useRef(() => {});
  const reportPlayingRef = useRef(() => {});
  const reportProgressRef = useRef(() => {});

  const [currentMedia, setCurrentMedia] = useState(null);
  const [paused, setPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [loopMode, setLoopMode] = useState("none");
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [resumePosition, setResumePosition] = useState(null);
  const [queueIds, setQueueIds] = useState([]);
  const [queueItems, setQueueItems] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [likedIds, setLikedIds] = useState(new Set());
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState(null);
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState(0);
  const [sleepTimerCompleted, setSleepTimerCompleted] = useState(false);

  const currentKind = getMediaKind(currentMedia?.mime_type || "");
  const navigation = getQueueNavigation(queueIds, queueIndex, loopMode);

  const applyQueue = useCallback((data, mediaId = currentMediaRef.current?.id) => {
    const normalized = normalizeQueueState(data, mediaId);
    if (!normalized) return data;

    queueIdsRef.current = normalized.queueIds;
    queueIndexRef.current = normalized.queueIndex;
    queueItemsRef.current = normalized.queueItems;
    setQueueIds(normalized.queueIds);
    setQueueItems(normalized.queueItems);
    setQueueIndex(normalized.queueIndex);
    return data;
  }, []);

  const applyLocalQueue = useCallback((items, mediaId) => {
    const queueItems = (items || []).filter(Boolean);
    const queueIds = queueItems.map((item) => Number(item.id));
    const selectedIndex = Math.max(0, queueIds.indexOf(Number(mediaId)));
    queueModeRef.current = "offline";
    queueItemsRef.current = queueItems;
    queueIdsRef.current = queueIds;
    queueIndexRef.current = selectedIndex;
    setQueueItems(queueItems);
    setQueueIds(queueIds);
    setQueueIndex(selectedIndex);
    return { items: queueItems, mediaIds: queueIds, index: selectedIndex };
  }, []);

  const refreshQueue = useCallback(() => (
    queueModeRef.current === "offline" || !offline.isConnected
      ? Promise.resolve({ items: queueItemsRef.current, mediaIds: queueIdsRef.current, index: queueIndexRef.current })
      : apiJson("/api/queue").then((data) => applyQueue(data))
  ), [applyQueue, offline.isConnected]);

  const refreshLikes = useCallback(() => (
    !offline.isConnected ? Promise.resolve() : apiJson("/api/likes")
      .then((items) => setLikedIds(new Set(items.map((item) => Number(item.id)))))
      .catch(() => {})
  ), [offline.isConnected]);

  const playbackPayload = useCallback((media, action, nextPosition, nextDuration) => ({
    mediaId: Number(media.id),
    title: media.title,
    action,
    position: Math.floor(nextPosition || 0),
    duration: Math.floor(nextDuration || media.duration || 0),
    loopMode: loopModeRef.current,
    shuffleEnabled: shuffleEnabledRef.current,
  }), []);

  const sendPlaybackEvent = useCallback((media, action, nextPosition = 0, nextDuration = 0) => {
    if (!media) return Promise.resolve();
    return offline.recordPlaybackEvent(playbackPayload(media, action, nextPosition, nextDuration))
      .then(() => { if (offline.isConnected) offline.flushSync(); })
      .catch(() => {});
  }, [offline, playbackPayload]);

  const sendActiveSession = useCallback((media, action, nextPosition = 0, nextDuration = 0) => {
    if (!media) return Promise.resolve();
    if (!offline.isConnected) return Promise.resolve();
    return apiJson("/api/playback/active", {
      method: "POST",
      body: JSON.stringify(playbackPayload(media, action, nextPosition, nextDuration)),
    }).catch(() => {});
  }, [offline.isConnected, playbackPayload]);

  const saveResumePositionFor = useCallback((media, nextPosition, nextDuration) => {
    if (!media || getMediaKind(media.mime_type) === "image") return Promise.resolve();
    if (!isValidResumePosition(nextPosition, nextDuration)) return Promise.resolve();

    return offline.saveResume(Number(media.id), Math.floor(nextPosition || 0), Math.floor(nextDuration || media.duration || 0))
      .then(() => { if (offline.isConnected) offline.flushSync(); })
      .catch(() => {});
  }, [offline]);

  const loadResumePosition = useCallback((media) => {
    if (!media || getMediaKind(media.mime_type) === "image") return;
    const sequence = resumeLoadSequenceRef.current + 1;
    resumeLoadSequenceRef.current = sequence;

    Promise.all([
      offline.getLocalResume(Number(media.id)),
      offline.isConnected ? apiJson(`/api/playback/resume/${Number(media.id)}`).catch(() => null) : Promise.resolve(null),
    ])
      .then(([local, remote]) => {
        if (resumeLoadSequenceRef.current !== sequence) return;
        const data = new Date(local?.updatedAt || 0).getTime() > new Date(remote?.timestamp || 0).getTime() ? local : remote;
        if (!data) return;
        const nextDuration = data.duration || media.duration || durationRef.current;
        setResumePosition(isValidResumePosition(data.position, nextDuration) ? Math.floor(data.position) : null);
      })
      .catch(() => {});
  }, [offline]);

  const unloadSound = useCallback(async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    soundSubscriptionRef.current?.remove?.();
    soundSubscriptionRef.current = null;
    if (!sound) return;
    try {
      sound.pause();
    } catch {
      // The player can already be detached while its native resource is removed.
    }
    sound.remove();
  }, []);

  const reportProgress = useCallback((nextPosition, nextDuration = durationRef.current) => {
    const media = currentMediaRef.current;
    if (!media) return;

    const normalizedPosition = Math.max(0, Math.floor(Number(nextPosition) || 0));
    const normalizedDuration = Math.max(0, Math.floor(Number(nextDuration) || media.duration || 0));
    positionRef.current = normalizedPosition;
    durationRef.current = normalizedDuration;
    setPosition(normalizedPosition);
    setDuration(normalizedDuration);

    if (pausedRef.current || getMediaKind(media.mime_type) === "image") return;
    if (normalizedPosition - lastResumeSaveRef.current >= PROGRESS_SYNC_SECONDS) {
      lastResumeSaveRef.current = normalizedPosition;
      saveResumePositionFor(media, normalizedPosition, normalizedDuration);
    }
    if (normalizedPosition - lastActiveUpdateRef.current >= PROGRESS_SYNC_SECONDS) {
      lastActiveUpdateRef.current = normalizedPosition;
      sendActiveSession(media, "play", normalizedPosition, normalizedDuration);
    }
  }, [saveResumePositionFor, sendActiveSession]);
  reportProgressRef.current = reportProgress;

  const reportPlaying = useCallback((isPlaying) => {
    const media = currentMediaRef.current;
    if (!media) return;

    if (!isPlaying && completedMediaRef.current === Number(media.id)) {
      completedMediaRef.current = null;
      pausedRef.current = true;
      setPaused(true);
      return;
    }
    if (!isPlaying && awaitingAutoplayRef.current === Number(media.id)) return;
    if (isPlaying) awaitingAutoplayRef.current = null;

    const nextPaused = !isPlaying;
    if (pausedRef.current === nextPaused) return;
    pausedRef.current = nextPaused;
    setPaused(nextPaused);

    const nextPosition = positionRef.current;
    const nextDuration = durationRef.current || media.duration || 0;
    const action = isPlaying ? "play" : "pause";
    if (!isPlaying) saveResumePositionFor(media, nextPosition, nextDuration);
    sendPlaybackEvent(media, action, nextPosition, nextDuration);
    sendActiveSession(media, action, nextPosition, nextDuration);
  }, [saveResumePositionFor, sendActiveSession, sendPlaybackEvent]);
  reportPlayingRef.current = reportPlaying;

  const loadAudio = useCallback(async (media, autoplay, startPosition) => {
    const localUri = offline.resolveMediaUri(media.id);
    if (!localUri && !offline.isConnected) throw new Error("This track is not available offline");
    const sound = createAudioPlayer({ uri: localUri || mediaStreamUrl(media.id) }, { updateInterval: 500 });
    sound.volume = mutedRef.current ? 0 : volumeRef.current;
    sound.loop = false;
    soundRef.current = sound;
    soundSubscriptionRef.current = sound.addListener("playbackStatusUpdate", (status) => {
      if (!status.isLoaded || Number(currentMediaRef.current?.id) !== Number(media.id)) return;
      reportProgressRef.current(status.currentTime, status.duration || media.duration || 0);
      if (status.didJustFinish) {
        if (awaitingAutoplayRef.current !== Number(media.id)) handleEndedRef.current();
        return;
      }
      reportPlayingRef.current(Boolean(status.playing));
    });

    if (startPosition > 0) await sound.seekTo(startPosition);
    if (autoplay) sound.play();
  }, [offline]);

  const startMedia = useCallback(async (media, options = {}) => {
    if (!media) return;
    const {
      autoplay = true,
      loadResume = true,
      replacementAction = "skip",
      startPosition = 0,
    } = options;
    const previousMedia = currentMediaRef.current;
    const previousPosition = positionRef.current;
    const previousDuration = durationRef.current || previousMedia?.duration || 0;

    if (previousMedia && Number(previousMedia.id) !== Number(media.id)) {
      saveResumePositionFor(previousMedia, previousPosition, previousDuration);
      if (replacementAction) {
        sendPlaybackEvent(previousMedia, replacementAction, previousPosition, previousDuration);
        sendActiveSession(previousMedia, replacementAction, previousPosition, previousDuration);
      }
    }

    await unloadSound();
    videoControllerRef.current = null;
    resumeLoadSequenceRef.current += 1;
    setResumePosition(null);

    const normalizedStart = Math.max(0, Math.floor(Number(startPosition) || 0));
    currentMediaRef.current = media;
    positionRef.current = normalizedStart;
    durationRef.current = Math.floor(media.duration || 0);
    pausedRef.current = getMediaKind(media.mime_type) === "image" ? true : !autoplay;
    pendingStartPositionRef.current = normalizedStart > 0 ? normalizedStart : null;
    awaitingAutoplayRef.current = autoplay ? Number(media.id) : null;
    completedMediaRef.current = null;
    lastResumeSaveRef.current = normalizedStart;
    lastActiveUpdateRef.current = normalizedStart;
    setCurrentMedia(media);
    setPosition(normalizedStart);
    setDuration(Math.floor(media.duration || 0));
    setPaused(pausedRef.current);

    const kind = getMediaKind(media.mime_type);
    if (kind === "audio") {
      pendingStartPositionRef.current = null;
      await loadAudio(media, autoplay, normalizedStart);
    } else if (kind === "image" && autoplay) {
      sendActiveSession(media, "play", 0, media.duration || 0);
    }

    if (autoplay && kind !== "image") {
      sendPlaybackEvent(media, "play", normalizedStart, media.duration || 0);
      sendActiveSession(media, "play", normalizedStart, media.duration || 0);
    }
    if (loadResume) loadResumePosition(media);
  }, [loadAudio, loadResumePosition, saveResumePositionFor, sendActiveSession, sendPlaybackEvent, unloadSound]);

  const stopPlayback = useCallback(async () => {
    const media = currentMediaRef.current;
    const nextPosition = positionRef.current;
    const nextDuration = durationRef.current || media?.duration || 0;
    if (media) {
      saveResumePositionFor(media, nextPosition, nextDuration);
      sendPlaybackEvent(media, "pause", nextPosition, nextDuration);
      sendActiveSession(media, "pause", nextPosition, nextDuration);
    }

    pausedRef.current = true;
    videoControllerRef.current?.pause?.();
    videoControllerRef.current = null;
    await unloadSound();
    resumeLoadSequenceRef.current += 1;
    currentMediaRef.current = null;
    positionRef.current = 0;
    durationRef.current = 0;
    awaitingAutoplayRef.current = null;
    pendingStartPositionRef.current = null;
    setCurrentMedia(null);
    setPosition(0);
    setDuration(0);
    setPaused(true);
    setResumePosition(null);
  }, [saveResumePositionFor, sendActiveSession, sendPlaybackEvent, unloadSound]);

  const pausePlaybackForSleepTimer = useCallback(() => {
    const media = currentMediaRef.current;
    awaitingAutoplayRef.current = null;
    if (!media || getMediaKind(media.mime_type) === "image") {
      pausedRef.current = true;
      setPaused(true);
      return;
    }

    reportPlayingRef.current(false);
    if (soundRef.current) soundRef.current.pause();
    else videoControllerRef.current?.pause?.();
    pausedRef.current = true;
    setPaused(true);
  }, []);

  const setSleepTimer = useCallback((minutes) => {
    const nextMinutes = Math.min(Math.max(Math.floor(Number(minutes) || 0), 0), SLEEP_TIMER_MAX_MINUTES);
    setSleepTimerCompleted(false);
    if (nextMinutes <= 0) {
      setSleepTimerEndsAt(null);
      setSleepTimerRemaining(0);
      return;
    }

    const nextRemaining = nextMinutes * 60;
    setSleepTimerEndsAt(Date.now() + nextRemaining * 1000);
    setSleepTimerRemaining(nextRemaining);
  }, []);

  const dismissSleepTimerNotification = useCallback(() => {
    setSleepTimerCompleted(false);
  }, []);

  const resumeAfterSleepTimer = useCallback(() => {
    const media = currentMediaRef.current;
    setSleepTimerCompleted(false);
    if (!media || getMediaKind(media.mime_type) === "image") return;

    reportPlayingRef.current(true);
    if (soundRef.current) soundRef.current.play();
    else videoControllerRef.current?.play?.();
  }, []);

  useEffect(() => {
    if (!sleepTimerEndsAt) return undefined;

    const updateSleepTimer = () => {
      const nextRemaining = Math.max(0, Math.ceil((sleepTimerEndsAt - Date.now()) / 1000));
      setSleepTimerRemaining(nextRemaining);
      if (nextRemaining > 0) return;

      setSleepTimerEndsAt(null);
      pausePlaybackForSleepTimer();
      setSleepTimerCompleted(true);
    };

    updateSleepTimer();
    const timerId = setInterval(updateSleepTimer, 1000);
    return () => clearInterval(timerId);
  }, [pausePlaybackForSleepTimer, sleepTimerEndsAt]);

  useEffect(() => {
    if (!currentMedia && sleepTimerEndsAt) {
      setSleepTimerEndsAt(null);
      setSleepTimerRemaining(0);
    }
  }, [currentMedia, sleepTimerEndsAt]);

  useEffect(() => {
    if (!currentMedia) setSleepTimerCompleted(false);
  }, [currentMedia]);

  const recordCurrentSkip = useCallback(() => {
    const media = currentMediaRef.current;
    if (!media) return;
    const nextPosition = positionRef.current;
    const nextDuration = durationRef.current || media.duration || 0;
    saveResumePositionFor(media, nextPosition, nextDuration);
    sendPlaybackEvent(media, "skip", nextPosition, nextDuration);
    sendActiveSession(media, "skip", nextPosition, nextDuration);
  }, [saveResumePositionFor, sendActiveSession, sendPlaybackEvent]);

  const selectQueueItem = useCallback((media, options = {}) => {
    const { skipCurrent = true } = options;
    if (!media) return Promise.resolve(null);
    if (queueModeRef.current === "offline" || !offline.isConnected) {
      if (!offline.resolveMediaUri(media.id)) return Promise.reject(new Error("This track is not available offline"));
      if (skipCurrent && Number(currentMediaRef.current?.id) !== Number(media.id)) recordCurrentSkip();
      const index = queueIdsRef.current.indexOf(Number(media.id));
      if (index >= 0) {
        queueIndexRef.current = index;
        setQueueIndex(index);
      }
      return startMedia(media, { replacementAction: null }).then(() => ({ items: queueItemsRef.current }));
    }
    return apiJson("/api/queue/select", {
      method: "POST",
      body: JSON.stringify({ mediaId: Number(media.id) }),
    }).then(async (data) => {
      if (skipCurrent && Number(currentMediaRef.current?.id) !== Number(media.id)) recordCurrentSkip();
      applyQueue(data, media.id);
      await startMedia(media, { replacementAction: null });
      return data;
    });
  }, [applyQueue, offline, recordCurrentSkip, startMedia]);

  const playQueueId = useCallback(async (mediaId, options = {}) => {
    if (queueModeRef.current === "offline" || !offline.isConnected) {
      const media = queueItemsRef.current.find((item) => Number(item.id) === Number(mediaId));
      return selectQueueItem(media, options);
    }
    const media = await apiJson(`/api/media/${Number(mediaId)}`);
    return selectQueueItem(media, options);
  }, [offline.isConnected, selectQueueItem]);

  const advance = useCallback(async (direction, options = {}) => {
    const { skipCurrent = true } = options;
    const ids = queueIdsRef.current;
    const index = queueIndexRef.current;
    const state = getQueueNavigation(ids, index, loopModeRef.current);
    const isNext = direction !== "prev";
    const hasLinearTarget = isNext ? state.hasLinearNext : state.hasLinearPrev;

    if (!hasLinearTarget) {
      if (loopModeRef.current !== "queue" || ids.length <= 1) return null;
      const wrapId = isNext ? ids[0] : ids[ids.length - 1];
      return playQueueId(wrapId, { skipCurrent });
    }

    if (queueModeRef.current === "offline" || !offline.isConnected) {
      const targetIndex = queueIndexRef.current + (isNext ? 1 : -1);
      return playQueueId(ids[targetIndex], { skipCurrent });
    }

    const data = await apiJson(isNext ? "/api/queue/next" : "/api/queue/prev", { method: "POST" });
    if (!data.mediaId) return null;
    if (skipCurrent) recordCurrentSkip();
    const media = await apiJson(`/api/media/${Number(data.mediaId)}`);
    await startMedia(media, { replacementAction: null });
    await refreshQueue().catch(() => {});
    return media;
  }, [offline.isConnected, playQueueId, recordCurrentSkip, refreshQueue, startMedia]);

  const handleEnded = useCallback(async () => {
    const media = currentMediaRef.current;
    if (!media || completedMediaRef.current === Number(media.id)) return;
    completedMediaRef.current = Number(media.id);
    const nextPosition = positionRef.current || durationRef.current || media.duration || 0;
    const nextDuration = durationRef.current || media.duration || 0;
    sendPlaybackEvent(media, "end", nextPosition, nextDuration);
    sendActiveSession(media, "end", nextPosition, nextDuration);

    const queueState = getQueueNavigation(
      queueIdsRef.current,
      queueIndexRef.current,
      loopModeRef.current
    );
    const action = getCompletionAction({
      hasLinearNext: queueState.hasLinearNext,
      loopMode: loopModeRef.current,
      queueLength: queueIdsRef.current.length,
    });

    if (action === "repeat") {
      completedMediaRef.current = null;
      positionRef.current = 0;
      setPosition(0);
      awaitingAutoplayRef.current = Number(media.id);
      pausedRef.current = false;
      setPaused(false);
      if (soundRef.current) await soundRef.current.seekTo(0);
      else videoControllerRef.current?.seek?.(0);
      sendPlaybackEvent(media, "play", 0, nextDuration);
      sendActiveSession(media, "play", 0, nextDuration);
      if (soundRef.current) soundRef.current.play();
      else videoControllerRef.current?.play?.();
      return;
    }

    if (action === "advance") {
      await advance("next", { skipCurrent: false });
      return;
    }
    if (action === "wrap") {
      await playQueueId(queueIdsRef.current[0], { skipCurrent: false });
      return;
    }

    pausedRef.current = true;
    setPaused(true);
  }, [advance, playQueueId, sendActiveSession, sendPlaybackEvent]);
  handleEndedRef.current = handleEnded;

  const playMedia = useCallback(async (media, categoryId = null) => {
    if (!media) return;
    if (!offline.isConnected) {
      const localItems = queueItemsRef.current.filter((item) => offline.resolveMediaUri(item.id));
      const items = localItems.some((item) => Number(item.id) === Number(media.id)) ? localItems : [media];
      applyLocalQueue(items, media.id);
      await startMedia(media, { autoplay: true, replacementAction: "skip" });
      return;
    }
    queueModeRef.current = "server";
    await startMedia(media, { autoplay: true, replacementAction: "skip" });
    const endpoint = categoryId
      ? `/api/queue/auto/${categoryId}?start=${media.id}`
      : `/api/queue/auto?start=${media.id}`;
    apiJson(endpoint, { method: "POST" })
      .then((data) => applyQueue(data, media.id))
      .catch(() => {});
  }, [applyLocalQueue, applyQueue, offline, startMedia]);

  const playOfflineMedia = useCallback(async (items, mediaId) => {
    if (!offline.leaseState.playable) throw new Error("Reconnect to validate offline access");
    const playableItems = (items || []).filter((item) => offline.resolveMediaUri(item.mediaId ?? item.id));
    const media = playableItems.find((item) => Number(item.mediaId ?? item.id) === Number(mediaId));
    if (!media) throw new Error("Downloaded audio is unavailable");
    const normalizedItems = playableItems.map((item) => ({ ...item, id: Number(item.mediaId ?? item.id) }));
    applyLocalQueue(normalizedItems, mediaId);
    await startMedia({ ...media, id: Number(media.mediaId ?? media.id) }, { autoplay: true, replacementAction: "skip" });
  }, [applyLocalQueue, offline, startMedia]);

  const togglePlayback = useCallback(() => {
    if (!currentMediaRef.current || getMediaKind(currentMediaRef.current.mime_type) === "image") return;
    if (pausedRef.current) {
      reportPlayingRef.current(true);
      if (soundRef.current) soundRef.current.play();
      else videoControllerRef.current?.play?.();
    } else {
      awaitingAutoplayRef.current = null;
      reportPlayingRef.current(false);
      if (soundRef.current) soundRef.current.pause();
      else videoControllerRef.current?.pause?.();
    }
  }, []);

  const seek = useCallback(async (seconds) => {
    const nextDuration = durationRef.current || currentMediaRef.current?.duration || 0;
    const nextPosition = Math.min(Math.max(0, Number(seconds) || 0), nextDuration || Infinity);
    positionRef.current = nextPosition;
    setPosition(nextPosition);
    if (soundRef.current) await soundRef.current.seekTo(nextPosition);
    else videoControllerRef.current?.seek?.(nextPosition);
  }, []);

  const applyResumePosition = useCallback(async () => {
    const nextPosition = resumePosition;
    const nextDuration = durationRef.current || currentMediaRef.current?.duration || 0;
    setResumePosition(null);
    if (!isValidResumePosition(nextPosition, nextDuration)) return;
    await seek(nextPosition);
    lastResumeSaveRef.current = nextPosition;
    lastActiveUpdateRef.current = nextPosition;
  }, [resumePosition, seek]);

  const registerVideoController = useCallback((controller) => {
    videoControllerRef.current = controller;
    if (!controller) return () => {};
    controller.setVolume?.(mutedRef.current ? 0 : volumeRef.current);
    controller.setLoop?.(false);
    if (pendingStartPositionRef.current != null) {
      controller.seek?.(pendingStartPositionRef.current);
      pendingStartPositionRef.current = null;
    }
    return () => {
      if (videoControllerRef.current === controller) videoControllerRef.current = null;
    };
  }, []);

  const reportVideoProgress = useCallback((nextPosition, nextDuration) => {
    reportProgress(nextPosition, nextDuration);
  }, [reportProgress]);

  const reportVideoPlaying = useCallback((isPlaying) => {
    reportPlaying(isPlaying);
  }, [reportPlaying]);

  const reportVideoEnded = useCallback(() => {
    handleEnded();
  }, [handleEnded]);

  const changeVolume = useCallback((nextVolume) => {
    const normalized = Math.min(Math.max(Number(nextVolume) || 0, 0), 1);
    volumeRef.current = normalized;
    mutedRef.current = normalized <= 0;
    setVolume(normalized);
    setMuted(normalized <= 0);
    if (soundRef.current) soundRef.current.volume = normalized;
    videoControllerRef.current?.setVolume?.(normalized);
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    const nextVolume = nextMuted ? 0 : volumeRef.current;
    if (soundRef.current) soundRef.current.volume = nextVolume;
    videoControllerRef.current?.setVolume?.(nextVolume);
  }, []);

  const toggleLoop = useCallback(() => {
    const next = nextLoopMode(loopModeRef.current);
    loopModeRef.current = next;
    setLoopMode(next);
    const media = currentMediaRef.current;
    if (media) sendActiveSession(media, pausedRef.current ? "pause" : "play", positionRef.current, durationRef.current);
  }, [sendActiveSession]);

  const toggleShuffle = useCallback(() => {
    if (shuffleEnabledRef.current) {
      shuffleEnabledRef.current = false;
      setShuffleEnabled(false);
      const media = currentMediaRef.current;
      if (media) sendActiveSession(media, pausedRef.current ? "pause" : "play", positionRef.current, durationRef.current);
      return Promise.resolve(false);
    }

    if (queueModeRef.current === "offline" || !offline.isConnected) {
      const currentId = Number(currentMediaRef.current?.id);
      const rest = queueItemsRef.current.filter((item) => Number(item.id) !== currentId).sort(() => Math.random() - 0.5);
      applyLocalQueue([currentMediaRef.current, ...rest], currentId);
      shuffleEnabledRef.current = true;
      setShuffleEnabled(true);
      return Promise.resolve(true);
    }
    return apiJson("/api/queue/shuffle", { method: "POST" }).then((data) => {
      applyQueue(data, currentMediaRef.current?.id);
      shuffleEnabledRef.current = true;
      setShuffleEnabled(true);
      const media = currentMediaRef.current;
      if (media) sendActiveSession(media, pausedRef.current ? "pause" : "play", positionRef.current, durationRef.current);
      return true;
    });
  }, [applyLocalQueue, applyQueue, offline.isConnected, sendActiveSession]);

  const addToQueue = useCallback((media) => (
    queueModeRef.current === "offline" || !offline.isConnected
      ? Promise.resolve(applyLocalQueue([...queueItemsRef.current, media], currentMediaRef.current?.id))
      : apiJson("/api/queue/items", {
      method: "POST",
      body: JSON.stringify({ mediaId: Number(media.id) }),
      }).then((data) => applyQueue(data))
  ), [applyLocalQueue, applyQueue, offline.isConnected]);

  const playNext = useCallback((media) => (
    queueModeRef.current === "offline" || !offline.isConnected
      ? Promise.resolve(applyLocalQueue([
        ...queueItemsRef.current.slice(0, queueIndexRef.current + 1), media,
        ...queueItemsRef.current.slice(queueIndexRef.current + 1),
      ], currentMediaRef.current?.id))
      : apiJson("/api/queue/items/next", {
      method: "POST",
      body: JSON.stringify({ mediaId: Number(media.id) }),
      }).then((data) => applyQueue(data))
  ), [applyLocalQueue, applyQueue, offline.isConnected]);

  const removeFromQueue = useCallback((mediaId) => {
    if (queueModeRef.current === "offline" || !offline.isConnected) {
      const activeRemoved = Number(currentMediaRef.current?.id) === Number(mediaId);
      const data = applyLocalQueue(queueItemsRef.current.filter((item) => Number(item.id) !== Number(mediaId)), currentMediaRef.current?.id);
      if (activeRemoved) return stopPlayback().then(() => ({ ...data, activeRemoved: true }));
      return Promise.resolve({ ...data, activeRemoved: false });
    }
    return apiJson(`/api/queue/items/${Number(mediaId)}`, { method: "DELETE" })
      .then(async (data) => {
        applyQueue(data);
        if (data.activeRemoved) await stopPlayback();
        return data;
      });
  }, [applyLocalQueue, applyQueue, offline.isConnected, stopPlayback]);

  const clearQueue = useCallback(() => (
    queueModeRef.current === "offline" || !offline.isConnected
      ? (applyLocalQueue([], null), stopPlayback().then(() => ({ items: [], activeRemoved: true })))
      : apiJson("/api/queue", { method: "DELETE" })
      .then(async (data) => {
        applyQueue(data, null);
        if (data.activeRemoved) await stopPlayback();
        return data;
      })
  ), [applyLocalQueue, applyQueue, offline.isConnected, stopPlayback]);

  const reorderQueue = useCallback((mediaIds) => (
    queueModeRef.current === "offline" || !offline.isConnected
      ? Promise.resolve(applyLocalQueue(mediaIds.map((id) => queueItemsRef.current.find((item) => Number(item.id) === Number(id))).filter(Boolean), currentMediaRef.current?.id))
      : apiJson("/api/queue/order", {
      method: "PUT",
      body: JSON.stringify({ mediaIds: mediaIds.map(Number) }),
      }).then((data) => applyQueue(data))
  ), [applyLocalQueue, applyQueue, offline.isConnected]);

  const toggleLike = useCallback((media) => {
    if (!offline.isConnected) return Promise.reject(new Error("Favorites cannot be changed offline"));
    const mediaId = Number(media?.id ?? media);
    const liked = likedIds.has(mediaId);
    return apiJson(`/api/likes/${mediaId}`, { method: liked ? "DELETE" : "PUT" }).then(() => {
      setLikedIds((current) => {
        const next = new Set(current);
        if (liked) next.delete(mediaId); else next.add(mediaId);
        return next;
      });
      return !liked;
    });
  }, [likedIds, offline.isConnected]);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {});
    refreshLikes();
    refreshQueue().catch(() => {});
  }, [refreshLikes, refreshQueue]);

  useEffect(() => {
    if (offline.isConnected || queueModeRef.current === "offline") return;
    const playableItems = queueItemsRef.current.filter((item) => offline.resolveMediaUri(item.id));
    const currentId = Number(currentMediaRef.current?.id);
    applyLocalQueue(playableItems, currentId);
    if (playableItems.some((item) => Number(item.id) === currentId)) return;
    if (playableItems.length > 0) {
      startMedia(playableItems[0], { autoplay: !pausedRef.current, replacementAction: "skip" }).catch(() => {});
    } else if (currentMediaRef.current) {
      stopPlayback();
    }
  }, [applyLocalQueue, offline, startMedia, stopPlayback]);

  useEffect(() => {
    if (activeRestoreStartedRef.current) return;
    activeRestoreStartedRef.current = true;
    let cancelled = false;

    apiJson("/api/playback/active")
      .then(async ({ active }) => {
        if (cancelled || !active?.mediaId || !["play", "pause"].includes(active.action)) return;
        const media = await apiJson(`/api/media/${Number(active.mediaId)}`);
        if (cancelled || currentMediaRef.current) return;
        const restoredLoop = ["none", "queue", "media"].includes(active.loopMode) ? active.loopMode : "none";
        loopModeRef.current = restoredLoop;
        shuffleEnabledRef.current = Boolean(active.shuffleEnabled);
        setLoopMode(restoredLoop);
        setShuffleEnabled(Boolean(active.shuffleEnabled));
        await startMedia(media, {
          autoplay: false,
          loadResume: false,
          replacementAction: null,
          startPosition: Math.floor(active.position || 0),
        });
        sendActiveSession(media, "pause", active.position || 0, active.duration || media.duration || 0);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [sendActiveSession, startMedia]);

  useEffect(() => () => {
    const media = currentMediaRef.current;
    if (media) {
      saveResumePositionFor(media, positionRef.current, durationRef.current || media.duration || 0);
      sendActiveSession(media, "pause", positionRef.current, durationRef.current || media.duration || 0);
    }
    videoControllerRef.current?.pause?.();
    unloadSound();
  }, [saveResumePositionFor, sendActiveSession, unloadSound]);

  const value = useMemo(() => ({
    addToQueue,
    advance,
    applyResumePosition,
    changeVolume,
    clearQueue,
    currentKind,
    currentMedia,
    duration,
    hasNext: navigation.hasNext,
    hasPrev: navigation.hasPrev,
    isLiked: (mediaId) => likedIds.has(Number(mediaId)),
    likedIds,
    loopMode,
    muted,
    paused,
    playMedia,
    playOfflineMedia,
    playNext,
    position,
    queueIndex,
    queueItems,
    queueIds,
    refreshLikes,
    refreshQueue,
    registerVideoController,
    removeFromQueue,
    reorderQueue,
    reportVideoEnded,
    reportVideoPlaying,
    reportVideoProgress,
    resumePosition,
    seek,
    selectQueueItem,
    shuffleEnabled,
    sleepTimerRemaining,
    setSleepTimer,
    stopPlayback,
    toggleLike,
    toggleLoop,
    toggleMute,
    togglePlayback,
    toggleShuffle,
    volume,
  }), [
    addToQueue, advance, applyResumePosition, changeVolume, clearQueue, currentKind, currentMedia,
    duration, likedIds, loopMode, muted, navigation.hasNext, navigation.hasPrev, paused, playMedia, playOfflineMedia,
    playNext, position, queueIds, queueIndex, queueItems, refreshLikes, refreshQueue,
    registerVideoController, removeFromQueue, reorderQueue, reportVideoEnded, reportVideoPlaying,
    reportVideoProgress, resumePosition, seek, selectQueueItem, shuffleEnabled, sleepTimerRemaining,
    setSleepTimer, stopPlayback, toggleLike, toggleLoop, toggleMute, togglePlayback, toggleShuffle, volume,
  ]);

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <SleepTimerCompleteModal
        canResume={Boolean(currentMedia) && currentKind !== "image"}
        mediaTitle={currentMedia?.title}
        onDismiss={dismissSleepTimerNotification}
        onResume={resumeAfterSleepTimer}
        visible={sleepTimerCompleted}
      />
    </PlayerContext.Provider>
  );
}
