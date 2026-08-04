import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, apiJson, mediaStreamUrl } from "../api";
import { getMediaKind, nextLoopMode } from "../utils/media";

const PlayerContext = createContext(null);

export function usePlayer() {
  return useContext(PlayerContext);
}

export function PlayerProvider({ children }) {
  const soundRef = useRef(null);
  const soundSubscriptionRef = useRef(null);
  const [currentMedia, setCurrentMedia] = useState(null);
  const [paused, setPaused] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [loopMode, setLoopMode] = useState("none");
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [queueIds, setQueueIds] = useState([]);
  const [queueItems, setQueueItems] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [likedIds, setLikedIds] = useState(new Set());

  const currentKind = getMediaKind(currentMedia?.mime_type || "");
  const hasPrev = queueIndex > 0;
  const hasNext = queueIndex > -1 && queueIndex < queueIds.length - 1;

  const unloadSound = useCallback(async () => {
    if (!soundRef.current) return;
    const sound = soundRef.current;
    soundRef.current = null;
    soundSubscriptionRef.current?.remove?.();
    soundSubscriptionRef.current = null;
    sound.remove();
  }, []);

  const refreshLikes = useCallback(() => {
    return apiJson("/api/likes")
      .then((items) => setLikedIds(new Set(items.map((item) => Number(item.id)))))
      .catch(() => {});
  }, []);

  const applyQueue = useCallback((data, mediaId = currentMedia?.id) => {
    if (!Array.isArray(data?.queue)) return data;
    const ids = data.queue.map(Number);
    const index = ids.indexOf(Number(mediaId));
    setQueueIds(ids);
    setQueueItems(Array.isArray(data.items) ? data.items : []);
    setQueueIndex(index > -1 ? index : 0);
    return data;
  }, [currentMedia?.id]);

  const refreshQueue = useCallback(() => {
    return apiJson("/api/queue")
      .then((data) => applyQueue(data))
      .catch(() => {});
  }, [applyQueue]);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => {});
    refreshLikes();
    refreshQueue();

    return () => {
      unloadSound();
    };
  }, [refreshLikes, refreshQueue, unloadSound]);

  const loadAudio = useCallback(async (media, autoplay = true) => {
    await unloadSound();
    const sound = createAudioPlayer({ uri: mediaStreamUrl(media.id) }, { updateInterval: 500 });
    sound.volume = muted ? 0 : volume;
    sound.loop = loopMode === "media";
    soundRef.current = sound;
    soundSubscriptionRef.current = sound.addListener("playbackStatusUpdate", (status) => {
      if (!status.isLoaded) return;
      setPosition(Math.floor(status.currentTime || 0));
      setDuration(Math.floor(status.duration || media.duration || 0));
      setPaused(!status.playing);
    });
    if (autoplay) sound.play();
  }, [loopMode, muted, unloadSound, volume]);

  const playMedia = useCallback(async (media, categoryId = null) => {
    if (!media) return;
    setCurrentMedia(media);
    setPosition(0);
    setDuration(media.duration || 0);
    setPaused(false);

    if (getMediaKind(media.mime_type) === "audio") {
      await loadAudio(media, true);
    } else {
      await unloadSound();
      setPaused(true);
    }

    const endpoint = categoryId
      ? `/api/queue/auto/${categoryId}?start=${media.id}`
      : `/api/queue/auto?start=${media.id}`;
    api(endpoint, { method: "POST" })
      .then((response) => response.json())
      .then((data) => applyQueue(data, media.id))
      .catch(() => {});
  }, [applyQueue, loadAudio, unloadSound]);

  const playQueueIndex = useCallback(async (index) => {
    const item = queueItems[index];
    if (!item) return;
    setQueueIndex(index);
    await playMedia(item);
  }, [playMedia, queueItems]);

  const advance = useCallback(async (direction) => {
    const delta = direction === "prev" ? -1 : 1;
    const nextIndex = queueIndex + delta;
    if (nextIndex >= 0 && nextIndex < queueItems.length) {
      await playQueueIndex(nextIndex);
    }
  }, [playQueueIndex, queueIndex, queueItems.length]);

  const togglePlayback = useCallback(async () => {
    if (currentKind !== "audio" || !soundRef.current) return;
    if (paused) {
      soundRef.current.play();
    } else {
      soundRef.current.pause();
    }
  }, [currentKind, paused]);

  const seek = useCallback(async (seconds) => {
    const nextPosition = Math.max(0, Number(seconds) || 0);
    setPosition(nextPosition);
    if (soundRef.current) await soundRef.current.seekTo(nextPosition);
  }, []);

  const changeVolume = useCallback(async (nextVolume) => {
    const normalized = Math.min(Math.max(Number(nextVolume) || 0, 0), 1);
    setVolume(normalized);
    setMuted(normalized <= 0);
    if (soundRef.current) soundRef.current.volume = normalized;
  }, []);

  const toggleMute = useCallback(async () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (soundRef.current) soundRef.current.volume = nextMuted ? 0 : volume;
  }, [muted, volume]);

  const toggleLoop = useCallback(async () => {
    setLoopMode((mode) => {
      const next = nextLoopMode(mode);
      if (soundRef.current) soundRef.current.loop = next === "media";
      return next;
    });
  }, []);

  const addToQueue = useCallback((media) => {
    return apiJson(`/api/queue/items/${media.id}`, { method: "POST" }).then((data) => applyQueue(data, currentMedia?.id));
  }, [applyQueue, currentMedia?.id]);

  const playNext = useCallback((media) => {
    return apiJson(`/api/queue/next/${media.id}`, { method: "POST" }).then((data) => applyQueue(data, currentMedia?.id));
  }, [applyQueue, currentMedia?.id]);

  const toggleLike = useCallback((media) => {
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
  }, [likedIds]);

  const value = useMemo(() => ({
    addToQueue,
    advance,
    changeVolume,
    currentKind,
    currentMedia,
    duration,
    hasNext,
    hasPrev,
    isLiked: (mediaId) => likedIds.has(Number(mediaId)),
    likedIds,
    loopMode,
    muted,
    paused,
    playMedia,
    playNext,
    position,
    queueItems,
    queueIds,
    refreshLikes,
    seek,
    setShuffleEnabled,
    shuffleEnabled,
    toggleLike,
    toggleLoop,
    toggleMute,
    togglePlayback,
    volume,
  }), [
    addToQueue, advance, changeVolume, currentKind, currentMedia, duration, hasNext, hasPrev,
    likedIds, loopMode, muted, paused, playMedia, playNext, position, queueItems, queueIds,
    refreshLikes, seek, shuffleEnabled, toggleLike, toggleLoop, toggleMute, togglePlayback, volume,
  ]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
