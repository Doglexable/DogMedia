import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { FullPlayer } from "./global-player/full-player";
import { MiniPlayer } from "./global-player/mini-player";
import { QueuePanel } from "./global-player/queue-panel";
import { hiddenMediaStyle, playerStyles as styles } from "./global-player/player-styles";
import {
  LOOP_MODES,
  getCategoryQuery as categoryQuery,
  getMediaFolder as mediaFolder,
  getMediaMeta as mediaMeta,
  getNextLoopMode as nextLoopMode,
} from "./global-player/player-utils";

const PlayerContext = createContext(null);
const DEFAULT_DOCUMENT_TITLE = "DogMedia";
const UNKNOWN_ARTIST_LABELS = new Set(["unknown", "unknown artist"]);
const PLAYER_VOLUME_KEY = "pfs:player-volume";
const PLAYER_MUTED_KEY = "pfs:player-muted";
const DEFAULT_VOLUME = 0.85;
const NOW_PLAYING_PAUSE_DEBOUNCE_MS = 1500;

export function useGlobalPlayer() {
  return useContext(PlayerContext);
}

function cleanMediaText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getAudioArtist(artists) {
  const value = cleanMediaText(artists);
  return UNKNOWN_ARTIST_LABELS.has(value.toLowerCase()) ? "" : value;
}

function getDocumentTitle(media, isAudioMedia) {
  if (!media) return DEFAULT_DOCUMENT_TITLE;

  const title = cleanMediaText(media.title);
  if (!title) return DEFAULT_DOCUMENT_TITLE;

  const artist = isAudioMedia ? getAudioArtist(media.artists) : "";
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
  const [currentMedia, setCurrentMedia] = useState(null);
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

  const fullMatch = matchPath("/media/:id", location.pathname);
  const fullMediaId = fullMatch?.params?.id ? Number(fullMatch.params.id) : null;
  const isFullPlayer = Number.isFinite(fullMediaId);
  const currentMime = currentMedia?.mime_type || "";
  const isAudio = currentMime.startsWith("audio/");
  const isVideo = currentMime.startsWith("video/");
  const isImage = currentMime.startsWith("image/");
  const streamSrc = currentMedia ? `/api/media/${currentMedia.id}/stream` : "";
  const thumbSrc = currentMedia ? `/api/media/${currentMedia.id}/thumbnail` : "";
  const meta = mediaMeta(currentMime);
  const currentQueueIndex = currentMedia ? queueIds.indexOf(Number(currentMedia.id)) : -1;
  const hasQueueNext = currentQueueIndex > -1 && currentQueueIndex < queueIds.length - 1;
  const hasQueuePrev = currentQueueIndex > 0;
  const hasLinearNext = hasNext || hasQueueNext;
  const hasLinearPrev = hasPrev || hasQueuePrev;
  const canGoNext = hasLinearNext || (loopMode === "queue" && queueIds.length > 1);
  const canGoPrev = hasLinearPrev || (loopMode === "queue" && queueIds.length > 1);

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
    if (!mediaRef.current || isImage) return;
    mediaRef.current.volume = volume;
    mediaRef.current.muted = muted || volume <= 0;
  }, [currentMedia?.id, isFullPlayer, isImage, muted, volume]);

  const refreshQueueState = useCallback((queue, mediaId) => {
    if (!Array.isArray(queue)) {
      setQueueIds([]);
      setQueueIndex(0);
      setHasPrev(false);
      setHasNext(false);
      return;
    }

    const idx = queue.indexOf(Number(mediaId));
    setQueueIds(queue.map(Number));
    setQueueIndex(idx > -1 ? idx : 0);
    setHasPrev(idx > 0);
    setHasNext(idx > -1 && idx < queue.length - 1);
  }, []);

  const applyQueueResponse = useCallback((data, fallbackMediaId = currentMedia?.id) => {
    refreshQueueState(data?.queue, fallbackMediaId);
    return data;
  }, [currentMedia?.id, refreshQueueState]);

  const refreshQueue = useCallback(() => {
    return api("/api/queue")
      .then((response) => response.json())
      .then((data) => applyQueueResponse(data));
  }, [applyQueueResponse]);

  useEffect(() => {
    refreshQueue().catch(() => refreshQueueState(null));
  }, [refreshQueue, refreshQueueState]);

  useEffect(() => {
    api("/api/likes")
      .then((response) => response.json())
      .then((items) => setLikedIds(new Set(items.map((item) => Number(item.id)))))
      .catch(() => {});
  }, []);

  const initializeQueue = useCallback((mediaId, nextCategoryId) => {
    const queueEndpoint = nextCategoryId
      ? `/api/queue/auto/${nextCategoryId}?start=${mediaId}`
      : `/api/queue/auto?start=${mediaId}`;

    api(queueEndpoint, { method: "POST" })
      .then((r) => r.json())
      .then((data) => refreshQueueState(data.queue, mediaId))
      .catch(() => refreshQueueState(null));
  }, [refreshQueueState]);

  const resetForMedia = useCallback((mediaItem, options = {}) => {
    const { autoplay = true, startPosition = 0 } = options;
    const nextPosition = Math.floor(startPosition || 0);

    setCurrentMedia(mediaItem);
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
  }, []);

  const loadResumePosition = useCallback((mediaId) => {
    api(`/api/playback/resume/${mediaId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.position != null) setResumePos(Math.floor(data.position));
      })
      .catch(() => {});
  }, []);

  const playMedia = useCallback((mediaItem, nextCategoryId = null) => {
    if (!mediaItem) return;
    setCategoryId(nextCategoryId);
    resetForMedia(mediaItem, { autoplay: true });
    initializeQueue(mediaItem.id, nextCategoryId);
    loadResumePosition(mediaItem.id);
  }, [initializeQueue, loadResumePosition, resetForMedia]);

  const playMediaById = useCallback((mediaId, nextCategoryId = null, options = {}) => {
    if (!Number.isFinite(Number(mediaId))) return;

    const { autoplay = true, loadResume = true, preserveQueue = false, startPosition = 0 } = options;
    const numericId = Number(mediaId);
    setCategoryId(nextCategoryId);
    if (!preserveQueue) initializeQueue(numericId, nextCategoryId);

    if (currentMedia?.id === numericId) {
      setShouldAutoPlay(autoplay);
      setPaused(!autoplay);
      if (startPosition > 0) {
        setPosition(Math.floor(startPosition));
        pendingSeekPositionRef.current = Math.floor(startPosition);
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
      })
      .catch(() => {});
  }, [currentMedia?.id, initializeQueue, loadResumePosition, resetForMedia]);

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

  const sendNowPlayingImmediately = useCallback((mediaItem, action, nextPosition = 0, nextDuration = 0, signal) => {
    if (!mediaItem) return;

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

  const sendNowPlaying = useCallback((mediaItem, action, nextPosition = 0, nextDuration = 0) => {
    if (!mediaItem) return;

    cancelPendingNowPlayingPause();
    if (action !== "pause") {
      sendNowPlayingImmediately(mediaItem, action, nextPosition, nextDuration);
      return;
    }

    nowPlayingPauseTimerRef.current = setTimeout(() => {
      nowPlayingPauseTimerRef.current = null;
      const controller = new AbortController();
      nowPlayingPauseControllerRef.current = controller;
      sendNowPlayingImmediately(mediaItem, action, nextPosition, nextDuration, controller.signal)
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
  }, [loopMode, shuffleEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadQueueItems = useCallback(() => {
    const seq = queueLoadSeqRef.current + 1;
    queueLoadSeqRef.current = seq;
    const visibleQueueIds = queueIds.filter((id) => !hiddenQueueIds.has(Number(id)));
    if (visibleQueueIds.length === 0) {
      setQueueItems([]);
      setQueueLoading(false);
      return;
    }

    setQueueLoading(true);
    Promise.all(
      visibleQueueIds.map((id) =>
        api(`/api/media/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    )
      .then((items) => {
        if (queueLoadSeqRef.current === seq) setQueueItems(items.filter(Boolean));
      })
      .finally(() => {
        if (queueLoadSeqRef.current === seq) setQueueLoading(false);
      });
  }, [hiddenQueueIds, queueIds]);

  useEffect(() => {
    if (!queueOpen) return;
    loadQueueItems();
  }, [loadQueueItems, queueOpen]);

  const stopPlayback = useCallback(() => {
    if (mediaRef.current) {
      mediaRef.current.pause();
      mediaRef.current.removeAttribute("src");
      mediaRef.current.load?.();
    }
    loadSeqRef.current += 1;
    setCurrentMedia(null);
    setPaused(true);
    setShouldAutoPlay(false);
    setPosition(0);
    setDuration(0);
    setHasNext(false);
    setHasPrev(false);
    setResumePos(null);
    if (isFullPlayer) navigate("/");
  }, [isFullPlayer, navigate]);

  const addToQueue = useCallback((mediaItemOrId) => {
    const mediaId = Number(mediaItemOrId?.id ?? mediaItemOrId);
    if (!Number.isFinite(mediaId)) return Promise.reject(new Error("Invalid media"));
    return api("/api/queue/items", {
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
        return applyQueueResponse(data);
      });
  }, [applyQueueResponse]);

  const playNext = useCallback((mediaItemOrId) => {
    const mediaId = Number(mediaItemOrId?.id ?? mediaItemOrId);
    if (!Number.isFinite(mediaId)) return Promise.reject(new Error("Invalid media"));
    return api("/api/queue/items/next", {
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
        return applyQueueResponse(data);
      });
  }, [applyQueueResponse]);

  const reorderQueue = useCallback((mediaIds) => {
    const previous = queueIds;
    const reorderedVisibleIds = mediaIds.map(Number);
    const expectedVisibleIds = queueIds.filter((id) => !hiddenQueueIds.has(Number(id)));
    const hasSameVisibleItems = reorderedVisibleIds.length === expectedVisibleIds.length
      && reorderedVisibleIds.every((id) => expectedVisibleIds.includes(id));
    if (!hasSameVisibleItems) {
      return Promise.reject(new Error("Queue changed; close and reopen it before reordering"));
    }

    let visibleIndex = 0;
    const nextQueue = queueIds.map((id) => (
      hiddenQueueIds.has(Number(id)) ? Number(id) : reorderedVisibleIds[visibleIndex++]
    ));
    refreshQueueState(nextQueue, currentMedia?.id);
    return api("/api/queue/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaIds: nextQueue }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not reorder queue");
        return applyQueueResponse(data);
      })
      .catch((error) => {
        refreshQueueState(previous, currentMedia?.id);
        throw error;
      });
  }, [applyQueueResponse, currentMedia?.id, hiddenQueueIds, queueIds, refreshQueueState]);

  const removeFromQueue = useCallback((mediaId) => {
    const numericId = Number(mediaId);
    if (numericId === Number(currentMedia?.id)) {
      queueLoadSeqRef.current += 1;
      setQueueLoading(false);
      setHiddenQueueIds((current) => new Set(current).add(numericId));
      setQueueItems((items) => items.filter((item) => Number(item.id) !== numericId));
      return Promise.resolve({ visibleOnly: true });
    }

    return api(`/api/queue/items/${numericId}`, { method: "DELETE" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not remove queue item");
        applyQueueResponse(data, currentMedia?.id);
        setHiddenQueueIds((current) => {
          const next = new Set(current);
          next.delete(numericId);
          return next;
        });
        return data;
      });
  }, [applyQueueResponse, currentMedia?.id]);

  const clearQueue = useCallback(() => {
    return api("/api/queue", { method: "DELETE" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not clear queue");
        applyQueueResponse(data, null);
        setHiddenQueueIds(new Set());
        if (data.activeRemoved) stopPlayback();
        return data;
      });
  }, [applyQueueResponse, stopPlayback]);

  const toggleLike = useCallback((mediaItemOrId) => {
    const mediaId = Number(mediaItemOrId?.id ?? mediaItemOrId);
    const liked = likedIds.has(mediaId);
    return api(`/api/likes/${mediaId}`, { method: liked ? "DELETE" : "PUT" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not update liked music");
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
        const canRestore = active?.mediaId && (active.action === "play" || active.action === "pause");

        if (!canRestore) return;

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

    mediaRef.current.currentTime = resumePos;
    setPosition(resumePos);
    appliedResumeRef.current = true;
    setResumePos(null);
  }, [currentMedia?.duration, duration, resumePos]);

  useEffect(() => {
    applyResumePosition();
  }, [applyResumePosition]);

  useEffect(() => {
    if (!isFullPlayer || !activeSessionChecked) return;
    if (currentMedia?.id === fullMediaId) return;
    const params = new URLSearchParams(location.search);
    const nextCategoryId = params.get("category");
    playMediaById(fullMediaId, nextCategoryId);
  }, [activeSessionChecked, currentMedia?.id, fullMediaId, isFullPlayer, location.search, playMediaById]);

  useEffect(() => {
    return () => {
      const nextPosition = mediaRef.current?.currentTime;
      if (nextPosition) saveResumePosition(nextPosition, true);
    };
  }, [currentMedia?.id, saveResumePosition]);

  const openFullPlayer = useCallback(() => {
    if (!currentMedia) return;
    navigate(`/media/${currentMedia.id}${categoryQuery(categoryId)}`);
  }, [categoryId, currentMedia, navigate]);

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

    const { skipCurrent = true, closeQueue = true } = options;
    const previousMedia = currentMedia;
    const previousPosition = mediaRef.current?.currentTime || position || 0;
    const previousDuration = mediaRef.current?.duration || duration || previousMedia?.duration || 0;

    if (previousMedia && previousMedia.id !== mediaItem.id && skipCurrent) {
      sendPlaybackEvent(previousMedia, "skip", previousPosition, previousDuration);
      sendNowPlaying(previousMedia, "skip", previousPosition, previousDuration);
    }

    api("/api/queue/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: Number(mediaItem.id) }),
    })
      .then((r) => r.json())
      .then((data) => {
        resetForMedia(mediaItem, { autoplay: true });
        loadResumePosition(mediaItem.id);
        sendNowPlaying(mediaItem, "play", 0, mediaItem.duration || 0);
        refreshQueueState(data.queue || queueIds, mediaItem.id);
        if (closeQueue) setQueueOpen(false);
        if (isFullPlayer) {
          navigate(`/media/${mediaItem.id}${categoryQuery(categoryId)}`);
        }
      })
      .catch(() => {});
  }, [categoryId, currentMedia, duration, isFullPlayer, loadResumePosition, navigate, position, queueIds, refreshQueueState, resetForMedia, sendNowPlaying, sendPlaybackEvent]);

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

    api("/api/queue/shuffle", { method: "POST" })
      .then((response) => response.json())
      .then((data) => {
        refreshQueueState(data.queue, currentMedia?.id);
        setShuffleEnabled(true);
      })
      .catch(() => {});
  }, [currentMedia?.id, refreshQueueState, shuffleEnabled]);

  const advance = useCallback((dir, options = {}) => {
    if (loopMode === "queue" && queueIds.length > 1) {
      if (dir === "next" && !hasLinearNext) {
        playQueueId(queueIds[0], { skipCurrent: options.skipCurrent !== false, closeQueue: false });
        return;
      }

      if (dir === "prev" && !hasLinearPrev) {
        playQueueId(queueIds[queueIds.length - 1], { skipCurrent: options.skipCurrent !== false, closeQueue: false });
        return;
      }
    }

    const endpoint = dir === "next" ? "/api/queue/next" : "/api/queue/prev";
    const previousMedia = currentMedia;
    const previousPosition = mediaRef.current?.currentTime || position || 0;
    const previousDuration = mediaRef.current?.duration || duration || previousMedia?.duration || 0;

    if (previousMedia && options.skipCurrent !== false) {
      sendPlaybackEvent(previousMedia, "skip", previousPosition, previousDuration);
      sendNowPlaying(previousMedia, "skip", previousPosition, previousDuration);
    }

    api(endpoint, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.mediaId) return null;
        return api(`/api/media/${data.mediaId}`)
          .then(readMediaItem)
          .then((nextMedia) => {
            resetForMedia(nextMedia);
            loadResumePosition(nextMedia.id);
            sendNowPlaying(nextMedia, "play", 0, nextMedia.duration || 0);
            if (isFullPlayer) {
              navigate(`/media/${nextMedia.id}${categoryQuery(categoryId)}`);
            }
            return api("/api/queue")
              .then((r) => r.json())
              .then((queueState) => refreshQueueState(queueState.queue, nextMedia.id))
              .catch(() => {});
          });
      })
      .catch(() => {});
  }, [categoryId, currentMedia, duration, hasLinearNext, hasLinearPrev, isFullPlayer, loadResumePosition, loopMode, navigate, playQueueId, position, queueIds, refreshQueueState, resetForMedia, sendNowPlaying, sendPlaybackEvent]);

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
    setPaused(false);
    sendPlaybackEvent(currentMedia, "play", nextPosition, nextDuration);
    sendNowPlaying(currentMedia, "play", nextPosition, nextDuration);
  }, [currentMedia, duration, sendNowPlaying, sendPlaybackEvent]);

  const handlePause = useCallback(() => {
    const nextPosition = mediaRef.current?.currentTime || 0;
    setPaused(true);
    saveResumePosition(nextPosition, true);
    sendNowPlaying(
      currentMedia,
      "pause",
      nextPosition,
      mediaRef.current?.duration || duration || currentMedia?.duration || 0
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
      mediaRef.current.currentTime = pendingSeekPositionRef.current;
      setPosition(pendingSeekPositionRef.current);
      pendingSeekPositionRef.current = null;
      return;
    }
    applyResumePosition();
  }, [applyResumePosition, currentMedia?.duration]);

  const handleEnded = useCallback(() => {
    sendPlaybackEvent(
      currentMedia,
      "end",
      mediaRef.current?.currentTime || duration || currentMedia?.duration || 0,
      mediaRef.current?.duration || duration || currentMedia?.duration || 0
    );
    sendNowPlaying(
      currentMedia,
      "end",
      mediaRef.current?.currentTime || duration || currentMedia?.duration || 0,
      mediaRef.current?.duration || duration || currentMedia?.duration || 0
    );
    if (loopMode === "media" && mediaRef.current) {
      mediaRef.current.currentTime = 0;
      setPosition(0);
      mediaRef.current.play().catch(() => {});
      return;
    }

    if (loopMode === "queue" && !hasLinearNext && queueIds.length > 0) {
      playQueueId(queueIds[0], { skipCurrent: false, closeQueue: false });
      return;
    }

    if (loopMode === "none" && !hasLinearNext) {
      setPaused(true);
      setShouldAutoPlay(false);
      return;
    }

    advance("next", { skipCurrent: false });
  }, [advance, currentMedia, duration, hasLinearNext, loopMode, playQueueId, queueIds, sendNowPlaying, sendPlaybackEvent]);

  useEffect(() => {
    if (!currentMedia || !("mediaSession" in navigator) || !("MediaMetadata" in window)) return undefined;

    const { mediaSession } = navigator;
    const title = cleanMediaText(currentMedia.title) || "Untitled";
    const artist = isAudio ? getAudioArtist(currentMedia.artists) : meta.label;

    mediaSession.metadata = new window.MediaMetadata({
      title,
      artist,
      album: mediaFolder(currentMedia) || "Library",
    });

    return () => {
      if ("metadata" in mediaSession) mediaSession.metadata = null;
    };
  }, [currentMedia, isAudio, meta.label]);

  useEffect(() => {
    if (!currentMedia || !("mediaSession" in navigator)) return undefined;

    const { mediaSession } = navigator;
    const setActionHandler = (action, handler) => {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // Some browsers expose Media Session but not every action.
      }
    };
    const actions = [
      "play",
      "pause",
      "stop",
      "seekbackward",
      "seekforward",
      "seekto",
      "previoustrack",
      "nexttrack",
    ];

    setActionHandler("play", () => {
      if (isImage) {
        openFullPlayer();
        return;
      }
      mediaRef.current?.play?.().catch(() => {});
    });
    setActionHandler("pause", () => {
      if (!isImage) mediaRef.current?.pause?.();
    });
    setActionHandler("stop", stopPlayback);
    setActionHandler("seekbackward", (details) => {
      const offset = Number(details.seekOffset || 10);
      seek(Math.max((mediaRef.current?.currentTime ?? 0) - offset, 0));
    });
    setActionHandler("seekforward", (details) => {
      const offset = Number(details.seekOffset || 10);
      const nextDuration = mediaRef.current?.duration || currentMedia.duration || 0;
      const nextPosition = (mediaRef.current?.currentTime ?? 0) + offset;
      seek(nextDuration > 0 ? Math.min(nextPosition, nextDuration) : nextPosition);
    });
    setActionHandler("seekto", (details) => {
      if (!Number.isFinite(details.seekTime)) return;
      if (details.fastSeek && typeof mediaRef.current?.fastSeek === "function") {
        mediaRef.current.fastSeek(details.seekTime);
        setPosition(details.seekTime);
        return;
      }
      seek(details.seekTime);
    });
    setActionHandler("previoustrack", canGoPrev ? () => advance("prev") : null);
    setActionHandler("nexttrack", canGoNext ? () => advance("next") : null);

    return () => {
      actions.forEach((action) => setActionHandler(action, null));
    };
  }, [advance, canGoNext, canGoPrev, currentMedia, isImage, openFullPlayer, seek, stopPlayback]);

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

  const contextValue = useMemo(() => ({
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
    queueCount: queueIds.filter((id) => !hiddenQueueIds.has(Number(id))).length,
    removeFromQueue,
    reorderQueue,
    duration,
    seek,
    togglePlayback,
    toggleLike,
  }), [addToQueue, advance, clearQueue, currentMedia, duration, hasNext, hasPrev, hiddenQueueIds, likedIds, openFullPlayer, paused, playMedia, playNext, position, queueIds, removeFromQueue, reorderQueue, seek, toggleLike, togglePlayback]);

  return (
    <PlayerContext.Provider value={contextValue}>
      {children}
      {currentMedia && (
        <>
          {isAudio && (
            <audio
              ref={mediaRef}
              src={streamSrc}
              controls={false}
              controlsList="nodownload noplaybackrate"
              disableRemotePlayback
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
              disablePictureInPicture
              disableRemotePlayback
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
              streamSrc={streamSrc}
              thumbFailed={thumbFailed}
              thumbSrc={thumbSrc}
              volume={volume}
              onAdvance={advance}
              onChangeVolume={changeVolume}
              onEnded={handleEnded}
              onLoadedMetadata={() => {
                handleLoadedMetadata();
                if (mediaRef.current && position > 0 && Math.abs(mediaRef.current.currentTime - position) > 1) {
                  mediaRef.current.currentTime = position;
                }
              }}
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
              liked={likedIds.has(Number(currentMedia.id))}
              onToggleLike={() => toggleLike(currentMedia)}
            />
          ) : (
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
              streamSrc={streamSrc}
              thumbSrc={thumbSrc}
              volume={volume}
              onAdvance={advance}
              onChangeVolume={changeVolume}
              onOpenQueue={() => setQueueOpen((open) => !open)}
              onOpenFull={openFullPlayer}
              onSeek={seek}
              onToggleLoop={() => setLoopMode((mode) => nextLoopMode(mode))}
              onToggleMute={toggleMute}
              onToggleShuffle={toggleShuffle}
              onToggle={togglePlayback}
              liked={likedIds.has(Number(currentMedia.id))}
              onToggleLike={() => toggleLike(currentMedia)}
            />
          )}
        </>
      )}
      {queueOpen && (
        <QueuePanel
          currentIndex={queueIndex}
          currentMedia={currentMedia}
          items={queueItems}
          loading={queueLoading}
          total={queueIds.filter((id) => !hiddenQueueIds.has(Number(id))).length}
          onClear={clearQueue}
          onClose={() => setQueueOpen(false)}
          onRemove={removeFromQueue}
          onReorder={reorderQueue}
          onSelect={playQueueMedia}
        />
      )}
    </PlayerContext.Provider>
  );
}
