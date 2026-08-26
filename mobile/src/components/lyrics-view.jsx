import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import ViewShot, { captureRef } from "react-native-view-shot";
import { api } from "../api";
import { alpha, radii, spacing, useTheme } from "../theme";
import { findActiveLyricsIndex, normalizeLyricsResponse } from "../utils/lyrics";
import { captureAndShareLyrics, createLyricsSelection, getLyricsShareIndex, getLyricsShareMetadata, getSelectedLyrics, LYRICS_CARD_SIZE, updateLyricsSelection } from "../utils/lyrics-share";
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

function LyricsCard({ artworkFailed, cardRef, cardWidth, metadata, onArtworkError, selected, styles }) {
  const cardHeight = cardWidth * 16 / 9;
  return (
    <ViewShot ref={cardRef} options={{ format: "png", quality: 1 }} style={[styles.shareCard, { width: cardWidth, height: cardHeight }]}>
      {metadata.artworkUri && !artworkFailed && <Image source={{ uri: metadata.artworkUri }} blurRadius={30} onError={onArtworkError} style={styles.shareCardBackdrop} />}
      <View style={styles.shareCardWash} />
      <View style={styles.shareCardBrand}><View style={styles.shareCardBrandMark}><Text style={styles.shareCardBrandMarkText}>DM</Text></View><Text style={styles.shareCardBrandText}>DogMedia</Text></View>
      <View style={styles.shareCardCopy}>
        <View style={styles.shareCardRule} />
        {selected.map((segment, index) => <Text key={`${segment.start}-${index}`} style={[styles.shareCardLine, { fontSize: cardWidth * 0.066, lineHeight: cardWidth * 0.071 }]}>{segment.text}</Text>)}
      </View>
      <View style={styles.shareCardFooter}>
        {metadata.artworkUri && !artworkFailed
          ? <Image source={{ uri: metadata.artworkUri }} onError={onArtworkError} style={styles.shareCardArtwork} />
          : <View style={[styles.shareCardArtwork, styles.shareCardArtworkFallback]}><Ionicons name="reader" size={20} color="#fff" /></View>}
        <View style={styles.shareCardMeta}><Text numberOfLines={1} style={styles.shareCardTitle}>{metadata.title}</Text><Text numberOfLines={1} style={styles.shareCardArtist}>{metadata.artists}</Text></View>
      </View>
    </ViewShot>
  );
}

function LyricsShareModal({ activeIndex, artworkUri, media, onClose, position, segments, visible }) {
  const { colors } = useTheme();
  const { height, width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const cardRef = useRef(null);
  const pickerRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [artworkFailed, setArtworkFailed] = useState(false);
  const metadata = useMemo(() => getLyricsShareMetadata(media, artworkUri), [artworkUri, media]);
  const selected = useMemo(() => getSelectedLyrics(segments, selection), [segments, selection]);
  const cardWidth = Math.min(width - spacing.xl * 2, height < 720 ? 190 : 230);
  const currentPlaybackIndex = getLyricsShareIndex(segments, position, activeIndex);

  useEffect(() => {
    if (visible) {
      setAnchorIndex(currentPlaybackIndex);
      setSelection(createLyricsSelection(currentPlaybackIndex, segments.length));
      setError("");
      setArtworkFailed(false);
    }
  }, [segments.length, visible]);

  const scrollPickerToActiveLine = useCallback(() => {
    if (!visible) return;
    pickerRef.current?.scrollToIndex({ animated: false, index: anchorIndex, viewPosition: 0.5 });
  }, [anchorIndex, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const frame = requestAnimationFrame(scrollPickerToActiveLine);
    return () => cancelAnimationFrame(frame);
  }, [scrollPickerToActiveLine, visible]);

  const share = useCallback(async () => {
    if (!cardRef.current || selected.length === 0 || sharing) return;
    setSharing(true);
    setError("");
    try {
      const result = await captureAndShareLyrics({
        capture: () => captureRef(cardRef, { format: "png", quality: 1, ...LYRICS_CARD_SIZE }),
        deleteFile: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
        isAvailable: Sharing.isAvailableAsync,
        share: (uri) => Sharing.shareAsync(uri, { dialogTitle: `Share ${metadata.title} lyrics`, mimeType: "image/png", UTI: "public.png" }),
      });
      if (result === "shared") onClose();
    } catch {
      setError("Could not create the lyrics card. Try sharing again.");
    } finally {
      setSharing(false);
    }
  }, [metadata.title, onClose, selected.length, sharing]);

  return (
    <Modal animationType="fade" onRequestClose={sharing ? undefined : onClose} statusBarTranslucent transparent visible={visible}>
      <View style={styles.shareOverlay}>
        <Pressable accessibilityLabel="Close lyrics sharing" disabled={sharing} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.shareDialog}>
          <View style={styles.shareHeader}>
            <View><Text style={styles.shareEyebrow}>Share a verse</Text><Text accessibilityRole="header" style={styles.shareHeading}>Choose up to 5 lines</Text></View>
            <Pressable accessibilityLabel="Close lyrics sharing" accessibilityRole="button" disabled={sharing} onPress={onClose} style={styles.shareClose}><Ionicons name="close" size={20} color={colors.text} /></Pressable>
          </View>
          <FlatList
            ref={pickerRef}
            contentContainerStyle={styles.sharePickerContent}
            data={segments}
            getItemLayout={(_data, index) => ({ index, length: 156 + spacing.xs, offset: index * (156 + spacing.xs) })}
            horizontal
            initialNumToRender={7}
            keyExtractor={(segment, index) => `${segment.start}-${index}`}
            maxToRenderPerBatch={8}
            onScrollToIndexFailed={({ index }) => pickerRef.current?.scrollToOffset({ animated: false, offset: Math.max(0, index * (156 + spacing.xs)) })}
            renderItem={({ item: segment, index }) => {
              const selectedLine = selection && index >= selection.start && index <= selection.end;
              return (
                <Pressable
                  accessibilityLabel={segment.text}
                  accessibilityRole="button"
                  accessibilityState={{ selected: Boolean(selectedLine) }}
                  onPress={() => setSelection((current) => updateLyricsSelection(current, index, segments.length))}
                  style={[styles.sharePickerLine, selectedLine && styles.sharePickerLineSelected]}
                >
                  <Text numberOfLines={3} style={[styles.sharePickerText, selectedLine && styles.sharePickerTextSelected]}>{segment.text}</Text>
                </Pressable>
              );
            }}
            showsHorizontalScrollIndicator={false}
            style={styles.sharePicker}
            windowSize={5}
          />
          <View style={styles.sharePreview}><LyricsCard artworkFailed={artworkFailed} cardRef={cardRef} cardWidth={cardWidth} metadata={metadata} onArtworkError={() => setArtworkFailed(true)} selected={selected} styles={styles} /></View>
          {error ? <Text accessibilityRole="alert" style={styles.shareError}>{error}</Text> : null}
          <View style={styles.shareActions}>
            <Text style={styles.shareCount}>{selected.length}/5 lines</Text>
            <Pressable accessibilityLabel="Share lyrics image" accessibilityRole="button" accessibilityState={{ disabled: sharing || selected.length === 0 }} disabled={sharing || selected.length === 0} onPress={share} style={[styles.shareButton, (sharing || selected.length === 0) && styles.shareButtonDisabled]}>
              {sharing ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="share-social" size={18} color="#fff" />}
              <Text style={styles.shareButtonText}>{sharing ? "Creating card…" : "Share image"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function LyricsView({ artworkUri = null, contentContainerStyle, listComponent: ListComponent = FlatList, media = null, mediaId, offlineLyrics = null, onSeek, position, style }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [lyrics, setLyrics] = useState(null);
  const [status, setStatus] = useState("loading");
  const [retryKey, setRetryKey] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const scrollRef = useRef(null);
  const lastDisplayIndexRef = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const controller = new AbortController();
    setLyrics(null);
    setStatus("loading");
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
    scrollRef.current?.scrollToIndex?.({ index, viewPosition: 0.5, animated: !reducedMotion });
  }, [reducedMotion]);

  useEffect(() => {
    if (!shareOpen && activeIndex >= 0) scrollToLine(activeIndex);
  }, [activeIndex, scrollToLine, shareOpen]);

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
    <View style={[styles.readyShell, style]}>
      <View style={styles.lyricsToolbar}>
        <Text style={styles.lyricsToolbarTitle}>Synced lyrics</Text>
        <Pressable accessibilityLabel="Share lyrics" accessibilityRole="button" onPress={() => setShareOpen(true)} style={styles.lyricsShareTrigger}>
          <Ionicons name="share-social" size={17} color={colors.text} /><Text style={styles.lyricsShareTriggerText}>Share</Text>
        </Pressable>
      </View>
      <ListComponent
        ref={scrollRef}
        style={styles.shell}
        contentContainerStyle={[styles.content, contentContainerStyle]}
        data={lyrics.segments}
        initialNumToRender={14}
        keyExtractor={(segment, index) => `${segment.start}-${index}`}
        maxToRenderPerBatch={12}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          scrollRef.current?.scrollToOffset?.({ animated: false, offset: Math.max(0, index * averageItemLength) });
          requestAnimationFrame(() => scrollToLine(index));
        }}
        renderItem={({ item: segment, index }) => {
          const active = index === activeIndex;
          const distance = Math.abs(index - displayIndex);
          return <Pressable
            accessibilityHint="Seeks playback to this lyric"
            accessibilityLabel={`${formatDuration(segment.start)}. ${segment.text}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSeek(segment.start)}
            style={styles.lineButton}
          >
            <Text style={[styles.line, active && styles.activeLine, distance > 1 && styles.dimLine]}>{segment.text}</Text>
          </Pressable>;
        }}
        showsVerticalScrollIndicator={false}
        windowSize={7}
      />
      <LyricsShareModal activeIndex={activeIndex} artworkUri={artworkUri} media={media} onClose={() => setShareOpen(false)} position={position} segments={lyrics.segments} visible={shareOpen} />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  shell: {
    flex: 1,
    minHeight: 0,
  },
  readyShell: { flex: 1, minHeight: 0 },
  lyricsToolbar: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: alpha(colors.text, 0.08) },
  lyricsToolbarTitle: { color: colors.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  lyricsShareTrigger: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: 17, backgroundColor: alpha(colors.text, 0.09) },
  lyricsShareTriggerText: { color: colors.text, fontSize: 12, fontWeight: "900" },
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
  shareOverlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.md, backgroundColor: "rgba(4,5,9,0.82)" },
  shareDialog: { width: "100%", maxWidth: 520, maxHeight: "96%", overflow: "hidden", borderWidth: 1, borderColor: alpha(colors.text, 0.12), borderRadius: radii.xl, backgroundColor: colors.bg },
  shareHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: alpha(colors.text, 0.08) },
  shareEyebrow: { color: colors.primary, fontSize: 10, fontWeight: "900", letterSpacing: 1.5, textTransform: "uppercase" },
  shareHeading: { marginTop: 3, color: colors.text, fontSize: 21, lineHeight: 25, fontWeight: "900" },
  shareClose: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: colors.cardSoft },
  sharePicker: { flexGrow: 0, maxHeight: 108 },
  sharePickerContent: { gap: spacing.xs, padding: spacing.sm },
  sharePickerLine: { width: 156, minHeight: 84, justifyContent: "center", padding: spacing.sm, borderWidth: 1, borderColor: "transparent", borderRadius: radii.md, backgroundColor: colors.surface },
  sharePickerLineSelected: { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.14) },
  sharePickerLineDisabled: { opacity: 0.36 },
  sharePickerText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: "800" },
  sharePickerTextSelected: { color: colors.text, fontWeight: "900" },
  sharePreview: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  shareCard: { overflow: "hidden", padding: 20, backgroundColor: "#11131c" },
  shareCardBackdrop: { ...StyleSheet.absoluteFillObject, width: "125%", height: "125%", left: "-12.5%", top: "-12.5%", opacity: 0.68 },
  shareCardWash: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(6,7,12,0.52)" },
  shareCardBrand: { position: "relative", flexDirection: "row", alignItems: "center", gap: 7 },
  shareCardBrandMark: { width: 25, height: 25, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.45)", borderRadius: 13 },
  shareCardBrandMarkText: { color: "#fff", fontSize: 8, fontWeight: "900" },
  shareCardBrandText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  shareCardCopy: { position: "relative", flex: 1, justifyContent: "center", paddingVertical: spacing.lg },
  shareCardRule: { width: 38, height: 4, marginBottom: spacing.md, borderRadius: 2, backgroundColor: "#fff" },
  shareCardLine: { marginBottom: 6, color: "#fff", fontWeight: "900", letterSpacing: -0.8 },
  shareCardFooter: { position: "relative", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  shareCardArtwork: { width: 44, height: 44, borderRadius: 7 },
  shareCardArtworkFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  shareCardMeta: { flex: 1, minWidth: 0, gap: 2 },
  shareCardTitle: { color: "#fff", fontSize: 13, fontWeight: "900" },
  shareCardArtist: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "700" },
  shareError: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.warningText, backgroundColor: colors.warningBg, fontSize: 12, fontWeight: "800" },
  shareActions: { minHeight: 68, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, padding: spacing.md, borderTopWidth: 1, borderTopColor: alpha(colors.text, 0.08) },
  shareCount: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  shareButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 22, backgroundColor: colors.primary },
  shareButtonDisabled: { opacity: 0.45 },
  shareButtonText: { color: "#fff", fontSize: 13, fontWeight: "900" },
});
