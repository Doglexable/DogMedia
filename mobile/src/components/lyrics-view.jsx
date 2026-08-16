import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../api";
import { spacing, useTheme } from "../theme";
import { findActiveLyricsIndex, getCenteredLyricsOffset, normalizeLyricsResponse } from "../utils/lyrics";
import { formatDuration } from "../utils/media";

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

export function LyricsView({ contentContainerStyle, mediaId, offlineLyrics = null, onSeek, position, scrollComponent: ScrollComponent = ScrollView, style }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [lyrics, setLyrics] = useState(null);
  const [status, setStatus] = useState("loading");
  const [retryKey, setRetryKey] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const scrollRef = useRef(null);
  const lineLayoutsRef = useRef(new Map());
  const lastDisplayIndexRef = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const controller = new AbortController();
    setLyrics(null);
    setStatus("loading");
    lineLayoutsRef.current.clear();
    lastDisplayIndexRef.current = 0;

    if (offlineLyrics) {
      const data = normalizeLyricsResponse(offlineLyrics, mediaId);
      setLyrics(data);
      setStatus(data?.segments?.length ? "ready" : "empty");
      return () => controller.abort();
    }

    api(`/api/media/${mediaId}/lyrics`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Lyrics are temporarily unavailable");
        return normalizeLyricsResponse(await response.json(), mediaId);
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setLyrics(data);
        setStatus(data?.segments?.length ? "ready" : "empty");
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [mediaId, offlineLyrics, retryKey]);

  const activeIndex = useMemo(
    () => findActiveLyricsIndex(lyrics?.segments, position),
    [lyrics?.segments, position]
  );
  if (activeIndex >= 0) lastDisplayIndexRef.current = activeIndex;
  const displayIndex = activeIndex >= 0 ? activeIndex : lastDisplayIndexRef.current;

  const scrollToLine = useCallback((index) => {
    const line = lineLayoutsRef.current.get(index);
    if (!line || viewportHeight <= 0) return;
    scrollRef.current?.scrollTo({
      y: getCenteredLyricsOffset({
        contentHeight,
        lineHeight: line.height,
        lineY: line.y,
        viewportHeight,
      }),
      animated: !reducedMotion,
    });
  }, [contentHeight, reducedMotion, viewportHeight]);

  useEffect(() => {
    if (activeIndex >= 0) scrollToLine(activeIndex);
  }, [activeIndex, scrollToLine]);

  if (status === "loading") {
    return (
      <View accessibilityLabel="Loading lyrics" accessibilityRole="progressbar" style={[styles.state, style]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.stateText}>Loading lyrics</Text>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={[styles.state, style]}>
        <Text style={styles.stateTitle}>Lyrics unavailable</Text>
        <Text style={styles.stateText}>The lyrics service could not be reached.</Text>
        <Pressable accessibilityLabel="Retry loading lyrics" accessibilityRole="button" onPress={() => setRetryKey((key) => key + 1)} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (status === "empty" || !lyrics?.segments?.length) {
    return (
      <View style={[styles.state, style]}>
        <Text style={styles.stateTitle}>No synced lyrics</Text>
        <Text style={styles.stateText}>Line-synced lyrics are not available for this track.</Text>
      </View>
    );
  }

  return (
    <ScrollComponent
      ref={scrollRef}
      style={[styles.shell, style]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      onContentSizeChange={(_width, height) => setContentHeight(height)}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
      showsVerticalScrollIndicator={false}
    >
      {lyrics.segments.map((segment, index) => {
        const active = index === activeIndex;
        const distance = Math.abs(index - displayIndex);
        return (
          <Pressable
            key={`${segment.start}-${index}`}
            accessibilityHint="Seeks playback to this lyric"
            accessibilityLabel={`${formatDuration(segment.start)}. ${segment.text}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onLayout={(event) => {
              lineLayoutsRef.current.set(index, event.nativeEvent.layout);
              if (index === activeIndex) scrollToLine(index);
            }}
            onPress={() => onSeek(segment.start)}
            style={styles.lineButton}
          >
            <Text style={[styles.line, active && styles.activeLine, distance > 1 && styles.dimLine]}>{segment.text}</Text>
          </Pressable>
        );
      })}
    </ScrollComponent>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  shell: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    paddingVertical: 150,
    gap: spacing.sm,
  },
  lineButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingVertical: spacing.xs,
  },
  line: {
    color: colors.muted,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "800",
  },
  activeLine: {
    color: colors.primary,
    fontSize: 34,
    lineHeight: 39,
    fontWeight: "900",
  },
  dimLine: {
    opacity: 0.62,
  },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.xl,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "900",
    textAlign: "center",
  },
  stateText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  retryButton: {
    minWidth: 96,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  retryText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "900",
  },
});
