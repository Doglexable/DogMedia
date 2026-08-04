import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../api";
import { colors, spacing } from "../theme";
import { findActiveLyricsIndex } from "../utils/lyrics";

export function LyricsView({ mediaId, position, onSeek }) {
  const [lyrics, setLyrics] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLyrics(null);
    api(`/api/media/${mediaId}/lyrics`)
      .then((response) => response.status === 404 ? null : response.json())
      .then((data) => {
        if (!cancelled) setLyrics(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mediaId]);

  const activeIndex = useMemo(
    () => findActiveLyricsIndex(lyrics?.segments, position),
    [lyrics?.segments, position]
  );
  const displayIndex = activeIndex >= 0 ? activeIndex : 0;

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: Math.max(0, displayIndex * 68 - 160), animated: true });
  }, [displayIndex]);

  if (!lyrics?.segments?.length) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Lyrics will appear here when available.</Text>
      </View>
    );
  }

  return (
    <ScrollView ref={scrollRef} style={styles.shell} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {lyrics.segments.map((segment, index) => {
        const active = index === activeIndex;
        const distance = Math.abs(index - displayIndex);
        return (
          <Pressable key={`${segment.start}-${index}`} onPress={() => onSeek(segment.start)}>
            <Text style={[styles.line, active && styles.activeLine, distance > 1 && styles.dimLine]}>{segment.text}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    minHeight: 260,
  },
  content: {
    paddingVertical: 150,
    gap: spacing.sm,
  },
  line: {
    color: "rgba(255,255,255,0.38)",
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "800",
  },
  activeLine: {
    color: colors.white,
    fontSize: 34,
    lineHeight: 39,
    fontWeight: "900",
  },
  dimLine: {
    opacity: 0.62,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
  },
  emptyText: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 24,
    lineHeight: 31,
    fontWeight: "900",
  },
});
