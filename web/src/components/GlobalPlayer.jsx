import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { api, createPlaybackSession, heartbeatPlaybackLease, mediaThumbnailUrl, releasePlaybackLease } from "../api";
import { MiniPlayer } from "./global-player/mini-player";
import {
  cleanMediaText,
  getAudioArtist,
  getMediaSessionMetadata,
  registerMediaSessionActionHandlers,
} from "./global-player/media-session";
import { hiddenMediaStyle } from "./global-player/player-styles";
import {
  LOOP_MODES,
  PAUSE_CACHE_TTL_MS,
  getAutoQueueEndpoint,
  getCategoryQuery as categoryQuery,
  getCompletionAction,
  getMediaMeta as mediaMeta,
  getNextLoopMode as nextLoopMode,
  getPlaylistSuggestionRoute,
  getQueueBoundaryParams,
  isPauseTimeoutExpired,
  shouldCompleteSleepTimer,
  shouldHandleSpaceKey,
  shouldSuggestSiblingMedia,
} from "./global-player/player-utils";
import { actualMediaQuality, MEDIA_QUALITY_STORAGE_KEY, readMediaQuality } from "../media-quality";
import { useEqualizer } from "./global-player/use-equalizer";

const PlayerContext = createContext(null);
const PlayerLibraryContext = createContext(null);
const FullPlayer = lazy(() => import("./global-player/full-player").then((module) => ({ default: module.FullPlayer })));
const QueuePanel = lazy(() => import("./global-player/queue-panel").then((module) => ({ default: module.QueuePanel })));
const SleepTimerCompleteDialog = lazy(() => import("./global-player/sleep-timer-complete-dialog").then((module) => ({ default: module.SleepTimerCompleteDialog })));
const PlaylistCompleteDialog = lazy(() => import("./global-player/playlist-complete-dialog").then((module) => ({ default: module.PlaylistCompleteDialog })));
const DEFAULT_DOCUMENT_TITLE = "Dogmedia";
const PLAYER_VOLUME_KEY = "pfs:player-volume";
const PLAYER_MUTED_KEY = "pfs:player-muted";
const DEFAULT_VOLUME = 0.85;
const NOW_PLAYING_PAUSE_DEBOUNCE_MS = 1500;
const SLEEP_TIMER_MAX_MINUTES = 60;

export function useGlobalPlayer() {
  return useContext(PlayerContext);
}

export function useGlobalPlayerLibrary() {
  return useContext(PlayerLibraryContext);
}

function getDocumentTitle(media, isAudioMedia) {
  if (!media) return DEFAULT_DOCUMENT_TITLE;

  const title = cleanMediaText(media.title);
  if (!title) return DEFAULT_DOCUMENT_TITLE;

  const artist = isAudioMedia ? getAudioArtist(media) : "";
  return artist
    ? `${title} by ${artist} - ${DEFAULT_DOCUMENT_TITLE}`
    : `${title} - ${DEFAULT_DOCUMENT_TITLE}`;
}

function readMediaItem(response) {
  if (!response.ok) throw new Error("Media unavailable");
  return response.json();
}

function clampVolume(value) {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(Math.max(value, 0), 1);
}

function readStoredVolume() {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  const stored = Number.parseFloat(window.localStorage.getItem(PLAYER_VOLUME_KEY));
  return clampVolume(stored);
}

function readStoredMuted() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PLAYER_MUTED_KEY) === "true";
}

export function GlobalPlayerProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const mediaRef = useRef(null);
  const loadSeqRef = useRef(0);
  const queueLoadSeqRef = useRef(0);
  const appliedResumeRef = useRef(false);
  const lastResumeSaveRef = useRef(0);
  const lastActiveUpdateRef = useRef(0);
  const pendingSeekPositionRef = useRef(null);
  const activeRestoreStartedRef = useRef(false);
  const nowPlayingPauseTimerRef = useRef(null);
  const nowPlayingPauseControllerRef = useRef(null);
  const mediaSessionActionsRef = useRef(null);
  const lastTriggerRef = useRef("user");
  const pauseStartedAtRef = useRef(null);
  const pauseDropTimerRef = useRef(null);
  const playbackSessionIdRef = useRef(null);
  const currentMediaRef = useRef(null);
  const playlistSuggestionRequestRef = useRef(0);
  const sleepTimerModeRef = useRef(null);
  const [currentMedia, setCurrentMedia] = useState(null);
  currentMediaRef.current = currentMedia;
  const [categoryId, setCategoryId] = useState(null);
  const [paused, setPaused] = useState(true);
  const [shouldAutoPlay, setShouldAutoPlay] = useState(true);
  const [activeSessionChecked, setActiveSessionChecked] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const [queueIds, setQueueIds] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [queueOffset, setQueueOffset] = useState(0);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const [queueItems, setQueueItems] = useState([]);
  const [hiddenQueueIds, setHiddenQueueIds] = useState(new Set());
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [loopMode, setLoopMode] = useState("none");
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [resumePos, setResumePos] = useState(null);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [likedIds, setLikedIds] = useState(new Set());
  const [volume, setVolume] = useState(readStoredVolume);
  const [muted, setMuted] = useState(readStoredMuted);
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState(null);
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState(0);
  const [sleepTimerMode, setSleepTimerMode] = useState(null);
  const [sleepTimerCompleted, setSleepTimerCompleted] = useState(false);
  sleepTimerModeRef.current = sleepTimerMode;
  const [playlistSuggestion, setPlaylistSuggestion] = useState(null);
  const [playerExpanded, setPlayerExpanded] = useState(false);
  const [quality, setQuality] = useState(readMediaQuality);
  const [streamSrc, setStreamSrc] = useState("");
  const [playbackAccessError, setPlaybackAccessError] = useState("");

  // EQ — hoisted here so AudioContext persists across full/mini player switches
  const { gains: eqGains, preset: eqPreset, eqEnabled,
    setGain: setEqGain, setPreset: setEqPreset, setEqEnabled } = useEqualizer(mediaRef);

  const fullMatch = matchPath("/media/:id", location.pathname);
  const fullMediaId = fullMatch?.params?.id ? Number(fullMatch.params.id) : null;
  const isRouteFullPlayer = Number.isFinite(fullMediaId);
  const isFullPlayer = isRouteFullPlayer || playerExpanded;
  const currentMime = typeof currentMedia?.mime_type === "string" ? currentMedia.mime_type : "";
  const isAudio = currentMime.startsWith("audio/");
  const isVideo = currentMime.startsWith("video/");
  const isImage = currentMime.startsWith("image/");
  const actualQuality = actualMediaQuality(quality, currentMedia?.available_qualities);
  const thumbSrc = mediaThumbnailUrl(currentMedia);
  const meta = mediaMeta(currentMime);
  const hasQueueNext = queueTotal > 0 && queueIndex < queueTotal - 1;
  const hasQueuePrev = queueTotal > 0 && queueIndex > 0;
  const hasLinearNext = hasNext || hasQueueNext;
  const hasLinearPrev = hasPrev || hasQueuePrev;
  const canGoNext = hasLinearNext || (loopMode === "queue" && queueTotal > 1);
  const canGoPrev = hasLinearPrev || (loopMode === "queue" && queueTotal > 1);

  const visibleQueueItems = useCallback((items) => (
    Array.isArray(items)
      ? items.filter((item) => !hiddenQueueIds.has(Number(item.id)))
      : null
  ), [hiddenQueueIds]);

  useEffect(() => {
    document.title = getDocumentTitle(currentMedia, isAudio);

    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [currentMedia, isAudio]);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_VOLUME_KEY, String(volume));
  }, [volume]);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_MUTED_KEY, String(muted));
  }, [muted]);

  useEffect(() => {
    const controller = new AbortController();
    setStreamSrc("");
    setPlaybackAccessError("");
    if (!currentMedia) return () => controller.abort();
    if (quality === "ori"
      && Array.isArray(currentMedia.available_qualities)
      && !currentMedia.available_qualities.includes("ori")) {
      window.localStorage.setItem(MEDIA_QUALITY_STORAGE_KEY, "high");
      setQuality("high");
      return () => controller.abort();
    }

    createPlaybackSession(currentMedia.id, quality, { signal: controller.signal })
      .then((session) => {
        playbackSessionIdRef.current = session.sessionId;
        setStreamSrc(session.streamUrl);
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setShouldAutoPlay(false);
          setPaused(true);
          setPlaybackAccessError(error.message);
        }
      });

    return () => controller.abort();
  }, [currentMedia?.id, quality]);

  useEffect(() => {
    if (!playbackSessionIdRef.current || !currentMedia || isImage) return;
    let stopped = false;
    const heartbeat = () => {
      const sessionId = playbackSessionIdRef.current;
      if (!sessionId) return;
      heartbeatPlaybackLease(sessionId).catch((error) => {
        if (stopped || error.code !== "PLAYBACK_LEASE_LOST") return;
        mediaRef.current?.pause?.();
        setStreamSrc("");
        setPaused(true);
        setShouldAutoPlay(false);
        setPlaybackAccessError(error.message);
      });
    };
    const interval = window.setInterval(heartbeat, 10_000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [currentMedia?.id, isImage, streamSrc]);

  useEffect(() => () => {
    releasePlaybackLease(playbackSessionIdRef.current);
  }, []);

  const changeQuality = useCallback((nextQuality) => {
    const nextPosition = mediaRef.current?.currentTime || position || 0;
    pendingSeekPositionRef.current = nextPosition;
    setShouldAutoPlay(!paused);
    window.localStorage.setItem(MEDIA_QUALITY_STORAGE_KEY, nextQuality);
    setQuality(nextQuality);
  }, [paused, position]);

  useEffect(() => {
    if (!mediaRef.current || isImage) return;
    mediaRef.current.volume = volume;
    mediaRef.current.muted = muted || volume <= 0;
  }, [currentMedia?.id, isFullPlayer, isImage, muted, volume]);

  const refreshQueueState = useCallback((queue, mediaId) => {
    if (!Array.isArray(queue)) {
      setQueueIds([]);
      setQueueIndex(0);
      setQueueOffset(0);
      setQueueTotal(0);
      setHasPrev(false);
      setHasNext(false);
      return;
    }

    const normalizedQueue = queue.map(Number);
    const idx = normalizedQueue.indexOf(Number(mediaId));
    setQueueIds((current) => (
      current.length === normalizedQueue.length && current.every((id, index) => id === normalizedQueue[index])
        ? current
        : normalizedQueue
    ));
    setQueueIndex(idx > -1 ? idx : 0);
    setQueueOffset(0);
    setQueueTotal(normalizedQueue.length);
    setHasPrev(idx > 0);
    setHasNext(idx > -1 && idx < normalizedQueue.length - 1);
  }, []);

  const applyQueueWindow = useCallback((data) => {
    const items = visibleQueueItems(data?.items) || [];
    setQueueItems(items);
    setQueueIds(items.map((item) => Number(item.id)));
    setQueueOffset(Number(data?.offset) || 0);
    setQueueTotal(Number(data?.total) || 0);
    setQueueIndex(Number(data?.currentIndex) || 0);
    setQueueRevision(Number(data?.revision) || 0);
    setHasPrev(Boolean(data?.total) && Number(data.currentIndex) > 0);
    setHasNext(Boolean(data?.total) && Number(data.currentIndex) < Number(data.total) - 1);
    return data;
  }, [visibleQueueItems]);

  const applyCompactQueueResponse = useCallback((data) => {
    setQueueTotal(Number(data?.total) || 0);
    setQueueIndex(Number(data?.currentIndex) || 0);
    setQueueRevision(Number(data?.revision) || 0);
    setHasPrev(Boolean(data?.total) && Number(data.currentIndex) > 0);
    setHasNext(Boolean(data?.total) && Number(data.currentIndex) < Number(data.total) - 1);
    return data;
  }, []);

  const refreshQueue = useCallback(() => {
    return api("/api/queue/window?limit=100")
      .then((response) => response.json())
      .then((data) => applyQueueWindow(data));
  }, [applyQueueWindow]);

  useEffect(() => {
    const applyExternalQueueChange = () => {
      refreshQueue().catch(() => {});
    };
    window.addEventListener("queue-changed", applyExternalQueueChange);
    return () => window.removeEventListener("queue-changed", applyExternalQueueChange);
  }, [refreshQueue]);

  useEffect(() => {
    refreshQueue().catch(() => refreshQueueState(null));
  }, [refreshQueue, refreshQueueState]);

  useEffect(() => {
    api("/api/likes")
      .then((response) => response.json())
      .then((items) => setLikedIds(new Set(items.map((item) => Number(item.id)))))
      .catch(() => {});
  }, []);

  const initializeQueue = useCallback((mediaId, nextCategoryId = null, queueContext = null) => {
    const queueEndpoint = getAutoQueueEndpoint(mediaId, nextCategoryId, queueContext);

    api(queueEndpoint, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        applyCompactQueueResponse(data);
        return refreshQueue();
      })
      .catch(() => refreshQueueState(null));
  }, [applyCompactQueueResponse, refreshQueue, refreshQueueState]);

  const resetForMedia = useCallback((mediaItem, options = {}) => {
    const { autoplay = true, startPosition = 0 } = options;
    const nextPosition = Math.floor(startPosition || 0);

    setCurrentMedia(mediaItem);
    playlistSuggestionRequestRef.current += 1;
    setPlaylistSuggestion(null);
    setPosition(nextPosition);
    setDuration(mediaItem.duration || 0);
    setPaused(!autoplay);
    setShouldAutoPlay(autoplay);
    setResumePos(null);
    setThumbFailed(false);
    appliedResumeRef.current = false;
    pendingSeekPositionRef.current = nextPosition > 0 ? nextPosition : null;
    lastResumeSaveRef.current = nextPosition;
    lastActiveUpdateRef.current = nextPosition;

    if (mediaRef.current && currentMediaRef.current?.id === mediaItem?.id) {
      if (Math.abs((mediaRef.current.currentTime || 0) - nextPosition) > 0.5) {
        mediaRef.current.currentTime = nextPosition;
      }
      if (autoplay) {
        mediaRef.current.play().catch(() => {});
      }
    }
  }, []);

  const loadResumePosition = useCallback((mediaId) => {
    api(`/api/playback/resume/${mediaId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.position != null) setResumePos(Math.floor(data.position));
      })
      .catch(() => {});
  }, []);

  const playMedia = useCallback((mediaItem, nextCategoryId = null, options = {}) => {
    if (!mediaItem) return;
    const context = options?.context || (nextCategoryId === "liked" ? "liked" : null);
    const resolvedCategoryId = nextCategoryId === "liked" ? null : nextCategoryId;
    setCategoryId(resolvedCategoryId);
    resetForMedia(mediaItem, { autoplay: true });
    initializeQueue(mediaItem.id, resolvedCategoryId, context);
    loadResumePosition(mediaItem.id);

    const isAudioMedia = mediaItem.mime_type?.startsWith("audio/");
    if (!isAudioMedia) {
      const search = resolvedCategoryId ? `?category=${resolvedCategoryId}` : "";
      navigate(`/media/${mediaItem.id}${search}`);
    }
  }, [initializeQueue, loadResumePosition, navigate, resetForMedia]);

  const playMediaById = useCallback((mediaId, nextCategoryId = null, options = {}) => {
    if (!Number.isFinite(Number(mediaId))) return;

    const { autoplay = true, loadResume = true, preserveQueue = false, startPosition = 0, context = null } = options;
    const numericId = Number(mediaId);
    const resolvedContext = context || (nextCategoryId === "liked" ? "liked" : null);
    const resolvedCategoryId = nextCategoryId === "liked" ? null : nextCategoryId;
    setCategoryId(resolvedCategoryId);
    if (!preserveQueue) initializeQueue(numericId, resolvedCategoryId, resolvedContext);

    if (currentMedia?.id === numericId) {
      setShouldAutoPlay(autoplay);
      setPaused(!autoplay);
      const nextPosition = Math.floor(startPosition || 0);
      setPosition(nextPosition);
      if (mediaRef.current) {
        if (Math.abs((mediaRef.current.currentTime || 0) - nextPosition) > 0.5) {
          mediaRef.current.currentTime = nextPosition;
        }
        if (autoplay) {
          mediaRef.current.play().catch(() => {});
        }
      }
      const isAudioMedia = currentMedia?.mime_type?.startsWith("audio/");
      if (!isAudioMedia && location.pathname !== `/media/${numericId}`) {
        const search = resolvedCategoryId ? `?category=${resolvedCategoryId}` : "";
        navigate(`/media/${numericId}${search}`);
      }
      return;
    }

    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;
    api(`/api/media/${numericId}`)
      .then(readMediaItem)
      .then((mediaItem) => {
        if (loadSeqRef.current !== seq) return;
        resetForMedia(mediaItem, { autoplay, startPosition });
        if (loadResume) loadResumePosition(mediaItem.id);
        const isAudioMedia = mediaItem?.mime_type?.startsWith("audio/");
        if (!isAudioMedia && location.pathname !== `/media/${mediaItem.id}`) {
          const search = resolvedCategoryId ? `?category=${resolvedCategoryId}` : "";
          navigate(`/media/${mediaItem.id}${search}`);
        }
      })
      .catch(() => {});
  }, [currentMedia?.id, currentMedia?.mime_type, initializeQueue, loadResumePosition, location.pathname, navigate, resetForMedia]);

  const sendPlaybackEvent = useCallback((mediaItem, action, nextPosition = 0, nextDuration = 0) => {
    if (!mediaItem) return;

    api("/api/playback/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaId: Number(mediaItem.id),
        title: mediaItem.title,
        action,
        position: Math.floor(nextPosition || 0),
        duration: Math.floor(nextDuration || mediaItem.duration || 0),
        loopMode,
        shuffleEnabled,
      }),
    }).catch(() => {});
  }, [loopMode, shuffleEnabled]);

  const sendNowPlayingImmediately = useCallback((mediaItem, action, nextPosition = 0, nextDuration = 0, signal, extra = {}) => {
    if (!mediaItem) return;

    const trigger = extra.trigger || lastTriggerRef.current || "user";
    const pausedAt = action === "pause" ? (extra.pausedAt || pauseStartedAtRef.current || new Date().toISOString()) : null;

    return api("/api/playback/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        mediaId: Number(mediaItem.id),
        title: mediaItem.title,
        action,
        position: Math.floor(nextPosition || 0),
        duration: Math.floor(nextDuration || mediaItem.duration || 0),
        loopMode,
        shuffleEnabled,
        trigger,
        pausedAt,
      }),
    }).catch(() => {});
  }, [loopMode, shuffleEnabled]);

  const cancelPendingNowPlayingPause = useCallback(() => {
    if (nowPlayingPauseTimerRef.current !== null) {
      clearTimeout(nowPlayingPauseTimerRef.current);
      nowPlayingPauseTimerRef.current = null;
    }
    nowPlayingPauseControllerRef.current?.abort();
    nowPlayingPauseControllerRef.current = null;
  }, []);

  const sendNowPlaying = useCallback((mediaItem, action, nextPosition = 0, nextDuration = 0, extra = {}) => {
    if (!mediaItem) return;

    cancelPendingNowPlayingPause();
    if (action !== "pause") {
      sendNowPlayingImmediately(mediaItem, action, nextPosition, nextDuration, undefined, extra);
      return;
    }

    nowPlayingPauseTimerRef.current = setTimeout(() => {
      nowPlayingPauseTimerRef.current = null;
      const controller = new AbortController();
      nowPlayingPauseControllerRef.current = controller;
      sendNowPlayingImmediately(mediaItem, action, nextPosition, nextDuration, controller.signal, extra)
        ?.finally(() => {
          if (nowPlayingPauseControllerRef.current === controller) {
            nowPlayingPauseControllerRef.current = null;
          }
        });
    }, NOW_PLAYING_PAUSE_DEBOUNCE_MS);
  }, [cancelPendingNowPlayingPause, sendNowPlayingImmediately]);

  useEffect(() => cancelPendingNowPlayingPause, [cancelPendingNowPlayingPause]);

  useEffect(() => {
    if (!currentMedia) return;
    sendNowPlaying(
      currentMedia,
      paused ? "pause" : "play",
      position,
      duration || currentMedia.duration || 0
    );
  }, [loopMode, shuffleEnabled]);

  const loadQueueItems = useCallback(() => {
    const seq = queueLoadSeqRef.current + 1;
    queueLoadSeqRef.current = seq;
    setQueueLoading(true);
    api("/api/queue/window?limit=100")
      .then((response) => response.json())
      .then((data) => {
        if (queueLoadSeqRef.current !== seq) return;
        applyQueueWindow(data);
      })
      .finally(() => {
        if (queueLoadSeqRef.current === seq) setQueueLoading(false);
      });
  }, [applyQueueWindow]);

  useEffect(() => {
    if (!queueOpen) return;
    loadQueueItems();
  }, [loadQueueItems, queueOpen]);

  const stopPlayback = useCallback(() => {
    const playbackSessionId = playbackSessionIdRef.current;
    playbackSessionIdRef.current = null;
    releasePlaybackLease(playbackSessionId);
    pauseStartedAtRef.current = null;
    if (pauseDropTimerRef.current) {
      clearTimeout(pauseDropTimerRef.current);
      pauseDropTimerRef.current = null;
    }
    if (mediaRef.current) {
      mediaRef.current.pause();
      mediaRef.current.removeAttribute("src");
      mediaRef.current.load?.();
    }
    loadSeqRef.current += 1;
    playlistSuggestionRequestRef.current += 1;
    setCurrentMedia(null);
    setPlaylistSuggestion(null);
    setPaused(true);
    setShouldAutoPlay(false);
    setPosition(0);
    setDuration(0);
    setHasNext(false);
    setHasPrev(false);
    setResumePos(null);
    setQueueOpen(false);
    setPlayerExpanded(false);
    setStreamSrc("");
    setPlaybackAccessError("");
    if (isRouteFullPlayer) navigate("/");
  }, [isRouteFullPlayer, navigate]);

  useEffect(() => {
    if (!paused || !currentMedia) {
      if (pauseDropTimerRef.current) {
        clearTimeout(pauseDropTimerRef.current);
        pauseDropTimerRef.current = null;
      }
      return;
    }

    if (!pauseDropTimerRef.current) {
      pauseDropTimerRef.current = setTimeout(() => {
        pauseDropTimerRef.current = null;
        api("/api/playback/active", { method: "DELETE" }).catch(() => {});
        stopPlayback();
      }, PAUSE_CACHE_TTL_MS);
    }

    return () => {
      if (pauseDropTimerRef.current) {
        clearTimeout(pauseDropTimerRef.current);
        pauseDropTimerRef.current = null;
      }
    };
  }, [currentMedia, paused, stopPlayback]);

  const pausePlaybackForSleepTimer = useCallback(() => {
    setShouldAutoPlay(false);
    if (!currentMedia || isImage) {
      setPaused(true);
      return;
    }

    if (mediaRef.current && !mediaRef.current.paused) {
      mediaRef.current.pause();
      return;
    }

    setPaused(true);
  }, [currentMedia, isImage]);

  const completeSleepTimer = useCallback(() => {
    sleepTimerModeRef.current = null;
    setSleepTimerMode(null);
    setSleepTimerEndsAt(null);
    setSleepTimerRemaining(0);
    setQueueOpen(false);
    playlistSuggestionRequestRef.current += 1;
    setPlaylistSuggestion(null);
    pausePlaybackForSleepTimer();
    setSleepTimerCompleted(true);
  }, [pausePlaybackForSleepTimer]);

  const setSleepTimer = useCallback((value) => {
    const boundaryMode = value === "media" || value === "playlist" ? value : null;
    const nextMinutes = boundaryMode
      ? 0
      : Math.min(Math.max(Math.floor(Number(value) || 0), 0), SLEEP_TIMER_MAX_MINUTES);
    setSleepTimerCompleted(false);
    if (!boundaryMode && nextMinutes <= 0) {
      sleepTimerModeRef.current = null;
      setSleepTimerMode(null);
      setSleepTimerEndsAt(null);
      setSleepTimerRemaining(0);
      return;
    }

    playlistSuggestionRequestRef.current += 1;
    setPlaylistSuggestion(null);
    if (boundaryMode) {
      sleepTimerModeRef.current = boundaryMode;
      setSleepTimerMode(boundaryMode);
      setSleepTimerEndsAt(null);
      setSleepTimerRemaining(0);
      return;
    }

    const nextRemaining = nextMinutes * 60;
    sleepTimerModeRef.current = "duration";
    setSleepTimerMode("duration");
    setSleepTimerEndsAt(Date.now() + nextRemaining * 1000);
    setSleepTimerRemaining(nextRemaining);
  }, []);

  const dismissSleepTimerNotification = useCallback(() => {
    setSleepTimerCompleted(false);
  }, []);

  const resumeAfterSleepTimer = useCallback(() => {
    setSleepTimerCompleted(false);
    setShouldAutoPlay(true);
    mediaRef.current?.play?.().catch(() => {});
  }, []);

  useEffect(() => {
    if (!sleepTimerEndsAt) return undefined;

    const updateSleepTimer = () => {
      if (sleepTimerModeRef.current !== "duration") return;
      const nextRemaining = Math.max(0, Math.ceil((sleepTimerEndsAt - Date.now()) / 1000));
      setSleepTimerRemaining(nextRemaining);
      if (nextRemaining > 0) return;

      completeSleepTimer();
    };

    updateSleepTimer();
    const timerId = window.setInterval(updateSleepTimer, 1000);
    return () => window.clearInterval(timerId);
  }, [completeSleepTimer, sleepTimerEndsAt]);

  useEffect(() => {
    if (!currentMedia && sleepTimerMode) {
      sleepTimerModeRef.current = null;
      setSleepTimerMode(null);
      setSleepTimerEndsAt(null);
      setSleepTimerRemaining(0);
    }
  }, [currentMedia, sleepTimerMode]);

  useEffect(() => {
    if (!currentMedia) setSleepTimerCompleted(false);
  }, [currentMedia]);

  const addToQueue = useCallback((mediaItemOrId) => {
    const mediaId = Number(mediaItemOrId?.id ?? mediaItemOrId);
    if (!Number.isFinite(mediaId)) return Promise.reject(new Error("Invalid media"));
    return api("/api/queue/items?compact=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not add to queue");
        setHiddenQueueIds((current) => {
          const next = new Set(current);
          next.delete(mediaId);
          return next;
        });
        applyCompactQueueResponse(data);
        if (queueOpen) await refreshQueue();
        return data;
      });
  }, [applyCompactQueueResponse, queueOpen, refreshQueue]);

  const addCategoryToQueue = useCallback((categoryOrId) => {
    const categoryId = Number(categoryOrId?.id ?? categoryOrId);
    if (!Number.isInteger(categoryId) || categoryId < 1) {
      return Promise.reject(new Error("Invalid category"));
    }
    return api(`/api/queue/items/category/${categoryId}?compact=1`, { method: "POST" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not add folder to queue");
        setHiddenQueueIds((current) => {
          const next = new Set(current);
          return next;
        });
        applyCompactQueueResponse(data);
        if (queueOpen) await refreshQueue();
        return data;
      });
  }, [applyCompactQueueResponse, queueOpen, refreshQueue]);

  const playNext = useCallback((mediaItemOrId) => {
    const mediaId = Number(mediaItemOrId?.id ?? mediaItemOrId);
    if (!Number.isFinite(mediaId)) return Promise.reject(new Error("Invalid media"));
    return api("/api/queue/items/next?compact=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not play media next");
        setHiddenQueueIds((current) => {
          const next = new Set(current);
          next.delete(mediaId);
          return next;
        });
        applyCompactQueueResponse(data);
        if (queueOpen) await refreshQueue();
        return data;
      });
  }, [applyCompactQueueResponse, queueOpen, refreshQueue]);

  const reorderQueue = useCallback((mediaIds) => {
    if (hiddenQueueIds.size > 0) {
      return Promise.reject(new Error("Close and reopen the queue before reordering hidden items"));
    }
    const reorderedVisibleIds = mediaIds.map(Number);
    const expectedVisibleIds = queueIds.filter((id) => !hiddenQueueIds.has(Number(id)));
    const hasSameVisibleItems = reorderedVisibleIds.length === expectedVisibleIds.length
      && reorderedVisibleIds.every((id) => expectedVisibleIds.includes(id));
    if (!hasSameVisibleItems) {
      return Promise.reject(new Error("Queue changed; close and reopen it before reordering"));
    }

    return api("/api/queue/window/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset: queueOffset, mediaIds: reorderedVisibleIds, revision: queueRevision }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not reorder queue");
        applyCompactQueueResponse(data);
        await refreshQueue();
        return data;
      })
      .catch(async (error) => {
        await refreshQueue().catch(() => {});
        throw error;
      });
  }, [applyCompactQueueResponse, hiddenQueueIds, queueIds, queueOffset, queueRevision, refreshQueue]);

  const removeFromQueue = useCallback((mediaId) => {
    const numericId = Number(mediaId);
    if (numericId === Number(currentMedia?.id)) {
      queueLoadSeqRef.current += 1;
      setQueueLoading(false);
      setHiddenQueueIds((current) => new Set(current).add(numericId));
      setQueueItems((items) => items.filter((item) => Number(item.id) !== numericId));
      return Promise.resolve({ visibleOnly: true });
    }

    return api(`/api/queue/items/${numericId}?compact=1`, { method: "DELETE" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not remove queue item");
        applyCompactQueueResponse(data);
        setHiddenQueueIds((current) => {
          const next = new Set(current);
          next.delete(numericId);
          return next;
        });
        await refreshQueue();
        return data;
      });
  }, [applyCompactQueueResponse, currentMedia?.id, refreshQueue]);

  const clearQueue = useCallback(() => {
    return api("/api/queue?compact=1", { method: "DELETE" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not clear queue");
        applyCompactQueueResponse(data);
        setQueueIds([]);
        setQueueItems([]);
        setHiddenQueueIds(new Set());
        if (data.activeRemoved) stopPlayback();
        return data;
      });
  }, [applyCompactQueueResponse, stopPlayback]);

  const toggleLike = useCallback((mediaItemOrId) => {
    const mediaId = Number(mediaItemOrId?.id ?? mediaItemOrId);
    const liked = likedIds.has(mediaId);
    return api(`/api/likes/${mediaId}`, { method: liked ? "DELETE" : "PUT" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not update favorites");
        setLikedIds((current) => {
          const next = new Set(current);
          if (liked) next.delete(mediaId); else next.add(mediaId);
          return next;
        });
        return !liked;
      });
  }, [likedIds]);

  useEffect(() => {
    if (activeRestoreStartedRef.current) return;
    activeRestoreStartedRef.current = true;
    let cancelled = false;

    api("/api/playback/active")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const active = data.active;
        if (!active) return;
        const isPaused = active.action === "pause" || active.state === "paused";
        if (isPaused && isPauseTimeoutExpired(active.pausedAt || active.timestamp)) {
          api("/api/playback/active", { method: "DELETE" }).catch(() => {});
          return;
        }

        const canRestore = active.mediaId && (active.action === "play" || active.action === "pause");
        if (!canRestore) return;

        if (active.trigger) lastTriggerRef.current = active.trigger;
        if (isPaused) pauseStartedAtRef.current = active.pausedAt || active.timestamp;

        const startPosition = Math.floor(active.position || 0);
        setLoopMode(LOOP_MODES.includes(active.loopMode) ? active.loopMode : "none");
        setShuffleEnabled(Boolean(active.shuffleEnabled));
        playMediaById(active.mediaId, null, {
          autoplay: false,
          loadResume: false,
          preserveQueue: true,
          startPosition,
        });
        api("/api/playback/active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaId: Number(active.mediaId),
            title: active.title,
            action: "pause",
            position: startPosition,
            duration: Math.floor(active.duration || 0),
            loopMode: LOOP_MODES.includes(active.loopMode) ? active.loopMode : "none",
            shuffleEnabled: Boolean(active.shuffleEnabled),
            trigger: active.trigger || "user",
            pausedAt: active.pausedAt || active.timestamp || new Date().toISOString(),
          }),
        }).catch(() => {});
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setActiveSessionChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [playMediaById]);

  useEffect(() => {
    if (!currentMedia || !isImage || !shouldAutoPlay) return;
    sendNowPlaying(currentMedia, "play", 0, currentMedia.duration || 0);
  }, [currentMedia, isImage, sendNowPlaying, shouldAutoPlay]);

  const saveResumePosition = useCallback((nextPosition, keepalive = false) => {
    if (!currentMedia || isImage || nextPosition < 2) return;
    const nextDuration = Math.floor(mediaRef.current?.duration || duration || currentMedia.duration || 0);
    if (nextDuration && nextPosition >= nextDuration - 3) return;

    api(`/api/playback/resume/${currentMedia.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive,
      body: JSON.stringify({
        position: Math.floor(nextPosition),
        duration: nextDuration,
      }),
    }).catch(() => {});
  }, [currentMedia, duration, isImage]);

  const applyResumePosition = useCallback(() => {
    if (appliedResumeRef.current || resumePos == null || !mediaRef.current) return;

    const nextDuration = Math.floor(mediaRef.current.duration || duration || currentMedia?.duration || 0);
    if (resumePos < 2 || (nextDuration && resumePos >= nextDuration - 3)) {
      appliedResumeRef.current = true;
      setResumePos(null);
      return;
    }

    if (Math.abs((mediaRef.current.currentTime || 0) - resumePos) > 0.5) {
      mediaRef.current.currentTime = resumePos;
    }
    setPosition(resumePos);
    appliedResumeRef.current = true;
    setResumePos(null);
  }, [currentMedia?.duration, duration, resumePos]);

  useEffect(() => {
    applyResumePosition();
  }, [applyResumePosition]);

  useEffect(() => {
    if (!isRouteFullPlayer || !activeSessionChecked) return;
    if (currentMedia?.id === fullMediaId) return;
    const params = new URLSearchParams(location.search);
    const nextCategoryId = params.get("category");
    const nextView = params.get("view");
    playMediaById(fullMediaId, nextCategoryId, nextView === "liked" ? { context: "liked" } : {});
  }, [activeSessionChecked, currentMedia?.id, fullMediaId, isRouteFullPlayer, location.search, playMediaById]);

  useEffect(() => {
    return () => {
      const nextPosition = mediaRef.current?.currentTime;
      if (nextPosition) saveResumePosition(nextPosition, true);
    };
  }, [currentMedia?.id, saveResumePosition]);

  const openFullPlayer = useCallback(() => {
    if (!currentMedia) return;
    setPlayerExpanded(true);
  }, [currentMedia]);

  const closeFullPlayer = useCallback(() => {
    if (!isAudio) {
      if (mediaRef.current && !mediaRef.current.paused) {
        mediaRef.current.pause();
      }
      setPaused(true);
    }
    setPlayerExpanded(false);
    if (isRouteFullPlayer) navigate("/");
  }, [isAudio, isRouteFullPlayer, navigate]);

  const togglePlayback = useCallback(() => {
    if (isImage) {
      openFullPlayer();
      return;
    }

    if (!mediaRef.current) return;

    if (mediaRef.current.paused) {
      mediaRef.current.play().catch(() => {});
    } else {
      mediaRef.current.pause();
    }
  }, [isImage, openFullPlayer]);

  const playQueueMedia = useCallback((mediaItem, options = {}) => {
    if (!mediaItem) return;

    const { skipCurrent = true, closeQueue = true, trigger = "user" } = options;
    lastTriggerRef.current = trigger;
    const previousMedia = currentMedia;
    const previousPosition = mediaRef.current?.currentTime || position || 0;
    const previousDuration = mediaRef.current?.duration || duration || previousMedia?.duration || 0;

    if (previousMedia && previousMedia.id !== mediaItem.id && skipCurrent) {
      sendPlaybackEvent(previousMedia, "skip", previousPosition, previousDuration);
      sendNowPlaying(previousMedia, "skip", previousPosition, previousDuration, { trigger });
    }

    api("/api/queue/select?compact=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: Number(mediaItem.id), trigger }),
    })
      .then((r) => r.json())
      .then((data) => {
        resetForMedia(mediaItem, { autoplay: true });
        loadResumePosition(mediaItem.id);
        sendNowPlaying(mediaItem, "play", 0, mediaItem.duration || 0, { trigger });
        applyCompactQueueResponse(data);
        if (queueOpen) refreshQueue().catch(() => {});
        if (closeQueue) setQueueOpen(false);
        const isAudioMedia = mediaItem?.mime_type?.startsWith("audio/");
        if (isRouteFullPlayer || !isAudioMedia) {
          navigate(`/media/${mediaItem.id}${categoryQuery(categoryId)}`);
        }
      })
      .catch(() => {});
  }, [applyCompactQueueResponse, categoryId, currentMedia, duration, isRouteFullPlayer, loadResumePosition, navigate, position, queueOpen, refreshQueue, resetForMedia, sendNowPlaying, sendPlaybackEvent]);

  const playQueueId = useCallback((mediaId, options = {}) => {
    if (!Number.isFinite(Number(mediaId))) return;

    api(`/api/media/${mediaId}`)
      .then(readMediaItem)
      .then((nextMedia) => playQueueMedia(nextMedia, options))
      .catch(() => {});
  }, [playQueueMedia]);

  const toggleShuffle = useCallback(() => {
    if (shuffleEnabled) {
      setShuffleEnabled(false);
      return;
    }

    api("/api/queue/shuffle?compact=1", { method: "POST" })
      .then((response) => response.json())
      .then((data) => {
        applyCompactQueueResponse(data);
        if (queueOpen) refreshQueue().catch(() => {});
        setShuffleEnabled(true);
      })
      .catch(() => {});
  }, [applyCompactQueueResponse, queueOpen, refreshQueue, shuffleEnabled]);

  const playQueueBoundary = useCallback((atEnd, options = {}) => {
    const params = getQueueBoundaryParams(atEnd, queueTotal);
    api(`/api/queue/window?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        const mediaId = data.items?.[0]?.id;
        if (mediaId) {
          playQueueId(mediaId, { skipCurrent: options.skipCurrent !== false, closeQueue: false, ...options });
        } else if (mediaRef.current) {
          mediaRef.current.currentTime = 0;
          setPosition(0);
          mediaRef.current.play().catch(() => {});
        }
      })
      .catch(() => {});
  }, [playQueueId, queueTotal]);

  const advance = useCallback((dir, options = {}) => {
    const trigger = options.trigger || "user";
    lastTriggerRef.current = trigger;

    if (loopMode === "queue" && queueTotal > 1) {
      if (dir === "next" && !hasLinearNext) {
        playQueueBoundary(false, { ...options, trigger });
        return;
      }

      if (dir === "prev" && !hasLinearPrev) {
        playQueueBoundary(true, { ...options, trigger });
        return;
      }
    }

    const endpoint = dir === "next"
      ? `/api/queue/next?compact=1&trigger=${trigger}`
      : `/api/queue/prev?compact=1&trigger=${trigger}`;
    const previousMedia = currentMedia;
    const previousPosition = mediaRef.current?.currentTime || position || 0;
    const previousDuration = mediaRef.current?.duration || duration || previousMedia?.duration || 0;

    if (previousMedia && options.skipCurrent !== false) {
      sendPlaybackEvent(previousMedia, "skip", previousPosition, previousDuration);
      sendNowPlaying(previousMedia, "skip", previousPosition, previousDuration, { trigger });
    }

    api(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger }),
    })
      .then((r) => r.json())
      .then((data) => {
        applyCompactQueueResponse(data);
        if (!data.mediaId) return null;
        return api(`/api/media/${data.mediaId}`)
          .then(readMediaItem)
          .then((nextMedia) => {
            resetForMedia(nextMedia);
            loadResumePosition(nextMedia.id);
            sendNowPlaying(nextMedia, "play", 0, nextMedia.duration || 0, { trigger });
            const isAudioMedia = nextMedia?.mime_type?.startsWith("audio/");
            if (isRouteFullPlayer || !isAudioMedia) {
              navigate(`/media/${nextMedia.id}${categoryQuery(categoryId)}`);
            }
            if (queueOpen) return refreshQueue().catch(() => {});
            return null;
          });
      })
      .catch(() => {});
  }, [applyCompactQueueResponse, categoryId, currentMedia, duration, hasLinearNext, hasLinearPrev, isRouteFullPlayer, loadResumePosition, loopMode, navigate, playQueueBoundary, position, queueOpen, queueTotal, refreshQueue, resetForMedia, sendNowPlaying, sendPlaybackEvent]);

  const seek = useCallback((eventOrValue) => {
    const nextPosition = Number(eventOrValue?.target ? eventOrValue.target.value : eventOrValue);
    setPosition(nextPosition);
    if (mediaRef.current) {
      mediaRef.current.currentTime = nextPosition;
    }
  }, []);

  const changeVolume = useCallback((nextValue) => {
    const nextVolume = clampVolume(Number(nextValue));
    setVolume(nextVolume);
    setMuted(nextVolume <= 0);
    if (mediaRef.current) {
      mediaRef.current.volume = nextVolume;
      mediaRef.current.muted = nextVolume <= 0;
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (volume <= 0) {
      setVolume(DEFAULT_VOLUME);
      setMuted(false);
      if (mediaRef.current) {
        mediaRef.current.volume = DEFAULT_VOLUME;
        mediaRef.current.muted = false;
      }
      return;
    }

    setMuted((current) => {
      const nextMuted = !current;
      if (mediaRef.current) mediaRef.current.muted = nextMuted;
      return nextMuted;
    });
  }, [volume]);

  const handlePlay = useCallback(() => {
    const nextPosition = mediaRef.current?.currentTime || 0;
    const nextDuration = mediaRef.current?.duration || duration || currentMedia?.duration || 0;
    pauseStartedAtRef.current = null;
    if (pauseDropTimerRef.current) {
      clearTimeout(pauseDropTimerRef.current);
      pauseDropTimerRef.current = null;
    }
    setPaused(false);
    setShouldAutoPlay(true);
    sendPlaybackEvent(currentMedia, "play", nextPosition, nextDuration);
    sendNowPlaying(currentMedia, "play", nextPosition, nextDuration, { trigger: lastTriggerRef.current || "user" });
  }, [currentMedia, duration, sendNowPlaying, sendPlaybackEvent]);

  const handlePause = useCallback(() => {
    const nextPosition = mediaRef.current?.currentTime || 0;
    const now = new Date().toISOString();
    pauseStartedAtRef.current = now;
    setPaused(true);
    setShouldAutoPlay(false);
    saveResumePosition(nextPosition, true);
    sendNowPlaying(
      currentMedia,
      "pause",
      nextPosition,
      mediaRef.current?.duration || duration || currentMedia?.duration || 0,
      { trigger: lastTriggerRef.current || "user", pausedAt: now }
    );
    sendPlaybackEvent(
      currentMedia,
      "pause",
      nextPosition,
      mediaRef.current?.duration || duration || currentMedia?.duration || 0
    );
  }, [currentMedia, duration, saveResumePosition, sendNowPlaying, sendPlaybackEvent]);

  const handleTimeUpdate = useCallback(() => {
    const nextPosition = Math.floor(mediaRef.current?.currentTime || 0);
    setPosition(nextPosition);
    if (nextPosition - lastResumeSaveRef.current < 10) return;
    lastResumeSaveRef.current = nextPosition;
    saveResumePosition(nextPosition);
    if (nextPosition - lastActiveUpdateRef.current >= 10) {
      lastActiveUpdateRef.current = nextPosition;
      sendNowPlaying(
        currentMedia,
        "play",
        nextPosition,
        mediaRef.current?.duration || duration || currentMedia?.duration || 0
      );
    }
  }, [currentMedia, duration, saveResumePosition, sendNowPlaying]);

  const handleLoadedMetadata = useCallback(() => {
    const nextDuration = Math.floor(mediaRef.current?.duration || currentMedia?.duration || 0);
    setDuration(nextDuration);
    if (pendingSeekPositionRef.current != null && mediaRef.current) {
      if (Math.abs((mediaRef.current.currentTime || 0) - pendingSeekPositionRef.current) > 0.5) {
        mediaRef.current.currentTime = pendingSeekPositionRef.current;
      }
      setPosition(pendingSeekPositionRef.current);
      pendingSeekPositionRef.current = null;
    } else {
      applyResumePosition();
    }
    if (shouldAutoPlay && mediaRef.current && mediaRef.current.paused) {
      mediaRef.current.play().catch(() => {});
    }
  }, [applyResumePosition, currentMedia?.duration, shouldAutoPlay]);

  const requestPlaylistSuggestion = useCallback((mediaItem, sourceCategoryId = null) => {
    if (!mediaItem?.id || !mediaItem?.category_id) return;
    const requestId = playlistSuggestionRequestRef.current + 1;
    playlistSuggestionRequestRef.current = requestId;

    const categoryQueryParam = sourceCategoryId ? `?category=${Number(sourceCategoryId)}` : "";
    api(`/api/queue/suggestion/${Number(mediaItem.id)}${categoryQueryParam}`)
      .then((response) => {
        if (!response.ok) throw new Error("Suggestion unavailable");
        return response.json();
      })
      .then((data) => {
        if (playlistSuggestionRequestRef.current !== requestId) return;
        if (Number(currentMediaRef.current?.id) !== Number(mediaItem.id)) return;
        if (!data?.suggestion) return;
        setQueueOpen(false);
        setPlaylistSuggestion(data.suggestion);
      })
      .catch(() => {});
  }, []);

  const dismissPlaylistSuggestion = useCallback(() => {
    playlistSuggestionRequestRef.current += 1;
    setPlaylistSuggestion(null);
  }, []);

  const playPlaylistSuggestion = useCallback(() => {
    const suggestion = playlistSuggestion;
    if (!suggestion?.media?.id || !suggestion?.category?.id) return;
    setPlaylistSuggestion(null);
    const suggestionRoute = getPlaylistSuggestionRoute(suggestion, isRouteFullPlayer);
    if (suggestionRoute) navigate(suggestionRoute);
    playMediaById(suggestion.media.id, suggestion.category.id, { autoplay: true });
  }, [isRouteFullPlayer, navigate, playMediaById, playlistSuggestion]);

  const handleEnded = useCallback(() => {
    const currentPosition = mediaRef.current?.currentTime || duration || currentMedia?.duration || 0;
    const currentDuration = mediaRef.current?.duration || duration || currentMedia?.duration || 0;

    sendPlaybackEvent(currentMedia, "end", currentPosition, currentDuration);
    sendNowPlaying(currentMedia, "end", currentPosition, currentDuration);

    const stopAtCurrentBoundary = shouldCompleteSleepTimer(sleepTimerMode, hasLinearNext);
    if (stopAtCurrentBoundary) {
      completeSleepTimer();
      return;
    }

    const action = getCompletionAction({
      hasLinearNext,
      loopMode: sleepTimerMode === "playlist" ? "none" : loopMode,
      queueLength: queueTotal,
    });

    if (action === "repeat") {
      if (mediaRef.current) {
        mediaRef.current.currentTime = 0;
        setPosition(0);
        mediaRef.current.play().catch(() => {});
      }
      return;
    }

    if (action === "advance") {
      advance("next", { skipCurrent: false, trigger: "system" });
      return;
    }

    if (action === "wrap") {
      playQueueBoundary(false, { skipCurrent: false, trigger: "system" });
      return;
    }

    setPaused(true);
    setShouldAutoPlay(false);
    if (shouldSuggestSiblingMedia(sleepTimerMode, sleepTimerCompleted)) {
      requestPlaylistSuggestion(currentMedia, categoryId);
    }
  }, [advance, categoryId, completeSleepTimer, currentMedia, duration, hasLinearNext, loopMode, playQueueBoundary, queueTotal, requestPlaylistSuggestion, sendNowPlaying, sendPlaybackEvent, sleepTimerCompleted, sleepTimerMode]);

  useEffect(() => {
    if (!currentMedia || !("mediaSession" in navigator) || !("MediaMetadata" in window)) return undefined;

    const { mediaSession } = navigator;
    mediaSession.metadata = new window.MediaMetadata(getMediaSessionMetadata(currentMedia, {
      isAudio,
      mediaLabel: meta.label,
      origin: window.location.origin,
    }));

    return () => {
      if ("metadata" in mediaSession) mediaSession.metadata = null;
    };
  }, [currentMedia, isAudio, meta.label]);

  useEffect(() => {
    mediaSessionActionsRef.current = {
      play: () => {
        if (isImage) {
          openFullPlayer();
          return;
        }
        mediaRef.current?.play?.().catch(() => {});
      },
      pause: () => {
        if (!isImage) mediaRef.current?.pause?.();
      },
      stop: stopPlayback,
      seekbackward: (details) => {
        const offset = Number(details.seekOffset || 10);
        seek(Math.max((mediaRef.current?.currentTime ?? 0) - offset, 0));
      },
      seekforward: (details) => {
        const offset = Number(details.seekOffset || 10);
        const nextDuration = mediaRef.current?.duration || currentMedia?.duration || 0;
        const nextPosition = (mediaRef.current?.currentTime ?? 0) + offset;
        seek(nextDuration > 0 ? Math.min(nextPosition, nextDuration) : nextPosition);
      },
      seekto: (details) => {
        if (!Number.isFinite(details.seekTime)) return;
        if (details.fastSeek && typeof mediaRef.current?.fastSeek === "function") {
          mediaRef.current.fastSeek(details.seekTime);
          setPosition(details.seekTime);
          return;
        }
        seek(details.seekTime);
      },
      previoustrack: () => advance("prev", { trigger: "user" }),
      nexttrack: () => advance("next", { trigger: "user" }),
    };
  });

  useEffect(() => {
    if (!currentMedia || !("mediaSession" in navigator)) return undefined;

    return registerMediaSessionActionHandlers(navigator.mediaSession, mediaSessionActionsRef, {
      canGoPrev,
      canGoNext,
    });
  }, [canGoNext, canGoPrev, currentMedia?.id]);

  useEffect(() => {
    if (!currentMedia || !("mediaSession" in navigator)) return;

    const { mediaSession } = navigator;
    mediaSession.playbackState = isImage ? "none" : paused ? "paused" : "playing";

    const nextDuration = Math.floor(mediaRef.current?.duration || duration || currentMedia.duration || 0);
    if (isImage || typeof mediaSession.setPositionState !== "function" || !Number.isFinite(nextDuration) || nextDuration <= 0) return;

    try {
      mediaSession.setPositionState({
        duration: nextDuration,
        playbackRate: mediaRef.current?.playbackRate || 1,
        position: Math.min(Math.max(Math.floor(position || 0), 0), nextDuration),
      });
    } catch {
      // Invalid transient media durations should not break playback controls.
    }
  }, [currentMedia, duration, isImage, paused, position]);

  const preventMediaMenu = useCallback((event) => event.preventDefault(), []);

  useEffect(() => {
    if (!currentMedia || isImage) return undefined;

    const handleKeyDown = (event) => {
      if (shouldHandleSpaceKey(event)) {
        event.preventDefault();
        togglePlayback();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentMedia, isImage, togglePlayback]);

  const contextValue = useMemo(() => ({
    addCategoryToQueue,
    addToQueue,
    advance,
    clearQueue,
    currentMedia,
    hasNext,
    hasPrev,
    isLiked: (mediaId) => likedIds.has(Number(mediaId)),
    likedIds,
    openQueue: () => setQueueOpen(true),
    openFullPlayer,
    paused,
    playMedia,
    playNext,
    position,
    queueCount: Math.max(queueTotal - hiddenQueueIds.size, 0),
    removeFromQueue,
    reorderQueue,
    duration,
    seek,
    stopPlayback,
    togglePlayback,
    toggleLike,
  }), [addCategoryToQueue, addToQueue, advance, clearQueue, currentMedia, duration, hasNext, hasPrev, hiddenQueueIds, likedIds, openFullPlayer, paused, playMedia, playNext, position, queueTotal, removeFromQueue, reorderQueue, seek, stopPlayback, toggleLike, togglePlayback]);

  const libraryContextValue = useMemo(() => ({
    addCategoryToQueue,
    addToQueue,
    currentMedia,
    isLiked: (mediaId) => likedIds.has(Number(mediaId)),
    likedIds,
    playMedia,
    playNext,
    stopPlayback,
    toggleLike,
  }), [addCategoryToQueue, addToQueue, currentMedia, likedIds, playMedia, playNext, stopPlayback, toggleLike]);

  return (
    <PlayerLibraryContext.Provider value={libraryContextValue}>
    <PlayerContext.Provider value={contextValue}>
      {children}
      {playbackAccessError && (
        <div
          role="alert"
          style={{
            position: "fixed", left: "50%", bottom: 84, zIndex: 1000,
            transform: "translateX(-50%)", maxWidth: "min(92vw, 520px)",
            padding: "12px 16px", borderRadius: 12,
            color: "var(--text)", background: "var(--surface)",
            border: "1px solid var(--border)", boxShadow: "0 16px 45px rgba(0,0,0,.28)",
            fontSize: 13, fontWeight: 700, textAlign: "center",
          }}
        >
          {playbackAccessError}
        </div>
      )}
      {currentMedia && (
        <>
          {isAudio && (
            <audio
              ref={mediaRef}
              src={streamSrc}
              controls={false}
              controlsList="nodownload noplaybackrate"
              disableRemotePlayback
              preload="metadata"
              autoPlay={shouldAutoPlay}
              muted={muted || volume <= 0}
              style={hiddenMediaStyle}
              onContextMenu={preventMediaMenu}
              onPlay={handlePlay}
              onPause={handlePause}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={handleEnded}
            />
          )}

          {isVideo && !isFullPlayer && (
            <video
              ref={mediaRef}
              src={streamSrc}
              controls={false}
              controlsList="nodownload noplaybackrate"
              disableRemotePlayback
              preload="metadata"
              autoPlay={!paused}
              muted={muted || volume <= 0}
              style={hiddenMediaStyle}
              onContextMenu={preventMediaMenu}
              onPlay={handlePlay}
              onPause={handlePause}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={handleEnded}
            />
          )}

          {isFullPlayer ? (
            <Suspense fallback={null}>
            <FullPlayer
              autoPlay={!paused}
              currentMedia={currentMedia}
              duration={duration}
              hasNext={canGoNext}
              hasPrev={canGoPrev}
              isAudio={isAudio}
              isImage={isImage}
              isVideo={isVideo}
              loopMode={loopMode}
              mediaRef={mediaRef}
              meta={meta}
              muted={muted}
              paused={paused}
              position={position}
              queueOpen={queueOpen}
              resumePos={resumePos}
              shuffleEnabled={shuffleEnabled}
              sleepTimerRemaining={sleepTimerRemaining}
              sleepTimerMode={sleepTimerMode}
              hasPlaylist={queueTotal > 1}
              streamSrc={streamSrc}
              thumbFailed={thumbFailed}
              thumbSrc={thumbSrc}
              volume={volume}
              quality={quality}
              actualQuality={actualQuality}
              onChangeQuality={changeQuality}
              onAdvance={advance}
              onChangeVolume={changeVolume}
              onEnded={handleEnded}
              onLoadedMetadata={handleLoadedMetadata}
              onCloseFull={closeFullPlayer}
              onOpenQueue={() => setQueueOpen((open) => !open)}
              onPause={handlePause}
              onPlay={handlePlay}
              onPreventMenu={preventMediaMenu}
              onResume={() => {
                if (mediaRef.current && resumePos != null) mediaRef.current.currentTime = resumePos;
                mediaRef.current?.play?.();
                setResumePos(null);
              }}
              onSeek={seek}
              onThumbError={() => setThumbFailed(true)}
              onTimeUpdate={handleTimeUpdate}
              onToggleLoop={() => setLoopMode((mode) => nextLoopMode(mode))}
              onToggleMute={toggleMute}
              onToggleShuffle={toggleShuffle}
              onToggle={togglePlayback}
              onSetSleepTimer={setSleepTimer}
              liked={likedIds.has(Number(currentMedia.id))}
              onToggleLike={() => toggleLike(currentMedia)}
              eqGains={eqGains}
              eqPreset={eqPreset}
              eqEnabled={eqEnabled}
              onSetEqGain={setEqGain}
              onSetEqPreset={setEqPreset}
              onSetEqEnabled={setEqEnabled}
            />
            </Suspense>
          ) : isAudio ? (
            <MiniPlayer
              currentMedia={currentMedia}
              duration={duration}
              hasNext={canGoNext}
              hasPrev={canGoPrev}
              isImage={isImage}
              loopMode={loopMode}
              meta={meta}
              muted={muted}
              paused={paused}
              position={position}
              queueOpen={queueOpen}
              shuffleEnabled={shuffleEnabled}
              sleepTimerRemaining={sleepTimerRemaining}
              sleepTimerMode={sleepTimerMode}
              hasPlaylist={queueTotal > 1}
              streamSrc={streamSrc}
              thumbSrc={thumbSrc}
              volume={volume}
              quality={quality}
              actualQuality={actualQuality}
              onChangeQuality={changeQuality}
              onAdvance={advance}
              onChangeVolume={changeVolume}
              onOpenQueue={() => setQueueOpen((open) => !open)}
              onOpenFull={openFullPlayer}
              onSeek={seek}
              onToggleLoop={() => setLoopMode((mode) => nextLoopMode(mode))}
              onToggleMute={toggleMute}
              onToggleShuffle={toggleShuffle}
              onToggle={togglePlayback}
              onSetSleepTimer={setSleepTimer}
              liked={likedIds.has(Number(currentMedia.id))}
              onToggleLike={() => toggleLike(currentMedia)}
            />
          ) : null}
        </>
      )}
      {queueOpen && (
        <Suspense fallback={null}>
        <QueuePanel
          currentIndex={queueIndex - queueOffset}
          currentMedia={currentMedia}
          items={queueItems}
          loading={queueLoading}
          total={Math.max(queueTotal - hiddenQueueIds.size, 0)}
          onClear={clearQueue}
          onClose={() => setQueueOpen(false)}
          onRemove={removeFromQueue}
          onReorder={reorderQueue}
          onSelect={playQueueMedia}
        />
        </Suspense>
      )}
      {sleepTimerCompleted && (
        <Suspense fallback={null}>
        <SleepTimerCompleteDialog
          canResume={Boolean(currentMedia) && !isImage}
          mediaTitle={currentMedia?.title}
          onDismiss={dismissSleepTimerNotification}
          onResume={resumeAfterSleepTimer}
        />
        </Suspense>
      )}
      {playlistSuggestion && !sleepTimerCompleted && (
        <Suspense fallback={null}>
        <PlaylistCompleteDialog
          suggestion={playlistSuggestion}
          onDismiss={dismissPlaylistSuggestion}
          onPlay={playPlaylistSuggestion}
        />
        </Suspense>
      )}
    </PlayerContext.Provider>
    </PlayerLibraryContext.Provider>
  );
}
