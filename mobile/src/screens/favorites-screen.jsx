import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson, publicShareUrl } from "../api";
import { MediaCard } from "../components/media-card";
import { MiniPlayer } from "../components/mini-player";
import { usePlayer } from "../context/player-context";
import { useOffline } from "../context/offline-context";
import { spacing, useTheme } from "../theme";
import { getPlaybackErrorPresentation } from "../utils/playback-errors";

export function FavoritesScreen({ navigation }) {
  const player = usePlayer();
  const offline = useOffline();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [reel, setReel] = useState(null);
  const [reelUrl, setReelUrl] = useState("");
  const [renderBusy, setRenderBusy] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    if (!offline.isConnected) {
      setItems(offline.downloads.filter((item) => item.liked));
      setRefreshing(false);
      return Promise.resolve();
    }
    return apiJson("/api/likes")
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setRefreshing(false));
  }, [offline.downloads, offline.isConnected]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!reel || !["queued", "processing"].includes(reel.status)) return undefined;
    const interval = setInterval(() => {
      apiJson("/api/music-shares/current").then(setReel).catch(() => {});
    }, 2500);
    return () => clearInterval(interval);
  }, [reel?.status]);

  const togglePick = (mediaId) => {
    const id = Number(mediaId?.id ?? mediaId);
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((selectedId) => selectedId !== id);
      if (current.length >= 10) {
        Alert.alert("Ten tracks maximum", "Remove one track before adding another.");
        return current;
      }
      return [...current, id];
    });
  };

  const renderReel = async () => {
    if (!selectedIds.length || renderBusy || !offline.isConnected) return;
    setRenderBusy(true);
    try {
      const data = await apiJson("/api/music-shares", {
        method: "POST",
        body: JSON.stringify({ mediaIds: selectedIds, expiresInDays: 1 }),
      });
      setReel(data);
      setReelUrl(publicShareUrl(data.sharePath));
      setPicking(false);
    } catch (error) {
      Alert.alert("Could not start the reel", error.message || "Try again when the server is available.");
    } finally {
      setRenderBusy(false);
    }
  };

  const shareReel = () => Share.share({
    title: "My Dogmedia favorites",
    message: `Ten seconds from each of my favorite tracks\n${reelUrl}`,
    url: reelUrl,
  });

  const play = (item) => {
    player.playMedia(item)
      .then(() => (navigation.getParent?.() || navigation).navigate("Player"))
      .catch((error) => {
        const presentation = getPlaybackErrorPresentation(error);
        Alert.alert(
          presentation.title,
          presentation.message,
          [{
            text: presentation.actionLabel,
            onPress: presentation.route ? () => navigation.navigate(presentation.route) : undefined,
          }],
          presentation.route ? { cancelable: false } : undefined
        );
      });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.headingRow}>
        <View><Text style={styles.eyebrow}>10 × 10 SECONDS</Text><Text style={styles.heading}>Favorites</Text></View>
        {!reel && <Pressable accessibilityRole="button" disabled={!offline.isConnected} onPress={() => { setPicking((value) => !value); setSelectedIds([]); }} style={styles.reelButton}><Text style={styles.reelButtonText}>{picking ? "Cancel" : "Build reel"}</Text></Pressable>}
      </View>
      {picking && <View style={styles.pickerBar}><View><Text style={styles.pickerCount}>{selectedIds.length}/10 selected</Text><Text style={styles.pickerHint}>Clips begin 2s before the first lyric.</Text></View><Pressable accessibilityRole="button" disabled={!selectedIds.length || renderBusy} onPress={renderReel} style={[styles.renderButton, (!selectedIds.length || renderBusy) && styles.disabled]}><Text style={styles.renderButtonText}>{renderBusy ? "Starting…" : "Render 4:3 video"}</Text></Pressable></View>}
      {reel && <View style={styles.reelStatus}><View style={styles.reelStatusTop}><Text style={styles.reelStatusTitle}>{reel.status === "ready" ? "Reel ready" : reel.status === "failed" ? "Render failed" : "Server is rendering"}</Text><Text style={styles.reelPercent}>{reel.progress || 0}%</Text></View><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${reel.progress || 0}%` }]} /></View><Text style={styles.reelStatusCopy}>{reel.status === "ready" ? "Your private 4:3 video is ready to share." : reel.status === "failed" ? (reel.error || "The video could not be prepared.") : "Each favorite becomes a 10-second scene. You can leave this screen while it processes."}</Text>{reelUrl ? <Pressable accessibilityRole="button" onPress={shareReel} style={styles.shareButton}><Text style={styles.shareButtonText}>Share private link</Text></Pressable> : null}</View>}
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={[styles.list, { paddingBottom: 140 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={<Text style={styles.empty}>Saved audio will appear here.</Text>}
        renderItem={({ item }) => {
          const order = selectedIds.indexOf(Number(item.id)) + 1;
          return <View style={[styles.pickCard, order > 0 && styles.pickCardSelected]}>{order > 0 && <View style={styles.pickBadge}><Text style={styles.pickBadgeText}>{order}</Text></View>}<MediaCard item={item} liked={player.isLiked(item.id)} onPress={picking ? togglePick : play} onPlayNext={picking ? undefined : player.playNext} onQueue={picking ? undefined : player.addToQueue} onToggleLike={!picking && offline.isConnected ? (media) => player.toggleLike(media).then(load) : undefined} /></View>;
        }}
      />
      <MiniPlayer navigation={navigation} />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 58,
    paddingHorizontal: spacing.lg,
  },
  heading: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
  },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, marginBottom: spacing.lg },
  eyebrow: { marginBottom: 2, color: colors.primary, fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  reelButton: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: 20, backgroundColor: colors.primary },
  reelButtonText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  pickerBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginBottom: spacing.md, padding: spacing.md, borderRadius: 14, backgroundColor: colors.cardSoft },
  pickerCount: { color: colors.text, fontSize: 14, fontWeight: "900" },
  pickerHint: { marginTop: 2, color: colors.muted, fontSize: 10, fontWeight: "700" },
  renderButton: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: 10, backgroundColor: colors.primary },
  renderButtonText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.42 },
  reelStatus: { gap: spacing.sm, marginBottom: spacing.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.subtle, borderRadius: 14, backgroundColor: colors.cardSoft },
  reelStatusTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reelStatusTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  reelPercent: { color: colors.primary, fontSize: 12, fontWeight: "900" },
  progressTrack: { height: 5, overflow: "hidden", borderRadius: 3, backgroundColor: colors.surface },
  progressFill: { height: "100%", borderRadius: 3, backgroundColor: colors.primary },
  reelStatusCopy: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  shareButton: { minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.primary },
  shareButtonText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  pickCard: { position: "relative", flex: 1, borderWidth: 2, borderColor: "transparent", borderRadius: 14 },
  pickCardSelected: { borderColor: colors.primary },
  pickBadge: { position: "absolute", zIndex: 3, top: 7, left: 7, width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.primary },
  pickBadgeText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  list: {
    gap: spacing.lg,
    paddingBottom: 140,
  },
  columns: {
    gap: spacing.md,
  },
  empty: {
    color: colors.muted,
    fontWeight: "800",
    paddingTop: spacing.xl,
  },
});
