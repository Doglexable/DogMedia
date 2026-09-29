import { useCallback, useEffect, useMemo, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Alert, FlatList, Pressable, RefreshControl, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiJson, publicShareUrl } from "../api";
import { MediaCard } from "../components/media-card";
import { MINI_PLAYER_CLEARANCE, MiniPlayer } from "../components/mini-player";
import { usePlayer } from "../context/player-context";
import { useOffline } from "../context/offline-context";
import { alpha, radii, spacing, useTheme } from "../theme";
import { getPlaybackErrorPresentation } from "../utils/playback-errors";

export function FavoritesScreen({ navigation }) {
  const player = usePlayer();
  const offline = useOffline();
  const { colors, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow]);
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

  const shareReel = () =>
    Share.share({
      title: "My Dogmedia favorites",
      message: `Ten seconds from each of my favorite tracks\n${reelUrl}`,
      url: reelUrl,
    });

  const play = (item) => {
    player
      .playMedia(item)
      .then(() => (navigation.getParent?.() || navigation).navigate("Player"))
      .catch((error) => {
        const presentation = getPlaybackErrorPresentation(error);
        Alert.alert(
          presentation.title,
          presentation.message,
          [
            {
              text: presentation.actionLabel,
              onPress: presentation.route ? () => navigation.navigate(presentation.route) : undefined,
            },
          ],
          presentation.route ? { cancelable: false } : undefined
        );
      });
  };

  const playAll = () => {
    if (!items.length) return;
    play(items[0]);
  };

  const currentMediaId = player.currentMedia?.id;
  const isPaused = player.paused;

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={[styles.list, { paddingBottom: MINI_PLAYER_CLEARANCE + insets.bottom }]}
        data={items}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl onRefresh={load} refreshing={refreshing} tintColor={colors.primary} />}
        ListHeaderComponent={
          <>
            {/* Spotify-style Liked Songs Hero Banner */}
            <View style={styles.heroBanner}>
              <View style={styles.badge}>
                <Ionicons color={colors.white} name="bookmark" size={28} />
              </View>
              <View style={styles.heroText}>
                <Text style={styles.eyebrow}>PLAYLIST</Text>
                <Text style={styles.heading}>Liked Songs</Text>
                <Text style={styles.subhead}>
                  {items.length} track{items.length === 1 ? "" : "s"} · Private library
                </Text>
              </View>
            </View>

            {/* Spotify Action Bar: Circular Play/Shuffle Button & Reel Builder */}
            <View style={styles.actionBar}>
              <View style={styles.actionLeft}>
                {!reel && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={!offline.isConnected}
                    onPress={() => {
                      setPicking((value) => !value);
                      setSelectedIds([]);
                    }}
                    style={[styles.reelButton, picking && styles.reelButtonActive]}
                  >
                    <Ionicons
                      color={picking ? colors.white : colors.text}
                      name={picking ? "close" : "sparkles"}
                      size={15}
                    />
                    <Text style={[styles.reelButtonText, picking && styles.reelButtonTextActive]}>
                      {picking ? "Cancel" : "Build 4:3 reel"}
                    </Text>
                  </Pressable>
                )}
              </View>
              {items.length > 0 && (
                <Pressable
                  accessibilityLabel="Play all liked songs"
                  accessibilityRole="button"
                  onPress={playAll}
                  style={styles.playButton}
                >
                  <Ionicons color={colors.white} name="play" size={24} />
                </Pressable>
              )}
            </View>

            {picking && (
              <View style={styles.pickerBar}>
                <View>
                  <Text style={styles.pickerCount}>{selectedIds.length}/10 selected</Text>
                  <Text style={styles.pickerHint}>Clips begin 2s before the first lyric.</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={!selectedIds.length || renderBusy}
                  onPress={renderReel}
                  style={[styles.renderButton, (!selectedIds.length || renderBusy) && styles.disabled]}
                >
                  <Text style={styles.renderButtonText}>{renderBusy ? "Starting…" : "Render 4:3 video"}</Text>
                </Pressable>
              </View>
            )}

            {reel && (
              <View style={styles.reelStatus}>
                <View style={styles.reelStatusTop}>
                  <Text style={styles.reelStatusTitle}>
                    {reel.status === "ready"
                      ? "Reel ready"
                      : reel.status === "failed"
                        ? "Render failed"
                        : "Server is rendering"}
                  </Text>
                  <Text style={styles.reelPercent}>{reel.progress || 0}%</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${reel.progress || 0}%` }]} />
                </View>
                <Text style={styles.reelStatusCopy}>
                  {reel.status === "ready"
                    ? "Your private 4:3 video is ready to share."
                    : reel.status === "failed"
                      ? reel.error || "The video could not be prepared."
                      : "Each favorite becomes a 10-second scene. You can leave this screen while it processes."}
                </Text>
                {reelUrl ? (
                  <Pressable accessibilityRole="button" onPress={shareReel} style={styles.shareButton}>
                    <Text style={styles.shareButtonText}>Share private link</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons color={colors.subtle} name="bookmark-outline" size={48} />
            <Text style={styles.emptyTitle}>Songs you like will appear here</Text>
            <Text style={styles.emptySubtitle}>Save tracks to build your favorites list.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const order = selectedIds.indexOf(Number(item.id)) + 1;
          if (picking) {
            return (
              <View style={[styles.pickCard, order > 0 && styles.pickCardSelected]}>
                {order > 0 && (
                  <View style={styles.pickBadge}>
                    <Text style={styles.pickBadgeText}>{order}</Text>
                  </View>
                )}
                <MediaCard
                  isCurrent={Number(currentMediaId) === Number(item.id)}
                  isPaused={isPaused}
                  item={item}
                  layout="row"
                  liked={player.isLiked(item.id)}
                  onPlayNext={undefined}
                  onPress={togglePick}
                  onQueue={undefined}
                  onToggleLike={undefined}
                />
              </View>
            );
          }
          return (
            <MediaCard
              isCurrent={Number(currentMediaId) === Number(item.id)}
              isPaused={isPaused}
              item={item}
              layout="row"
              liked={player.isLiked(item.id)}
              onPlayNext={player.playNext}
              onPress={play}
              onQueue={player.addToQueue}
              onToggleLike={offline.isConnected ? (media) => player.toggleLike(media).then(load) : undefined}
            />
          );
        }}
      />
      <MiniPlayer navigation={navigation} />
    </View>
  );
}

const makeStyles = (colors, shadow) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    list: {
      paddingTop: 54,
      paddingHorizontal: spacing.lg,
      gap: spacing.xs,
    },
    heroBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    badge: {
      width: 64,
      height: 64,
      borderRadius: radii.md,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      ...shadow.soft,
    },
    heroText: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    eyebrow: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 1,
    },
    heading: {
      color: colors.text,
      fontSize: 26,
      fontWeight: "900",
      letterSpacing: -0.3,
    },
    subhead: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "700",
    },
    actionBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: spacing.md,
    },
    actionLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    reelButton: {
      minHeight: 38,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.md,
      borderRadius: radii.full,
      backgroundColor: colors.cardSoft,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    reelButtonActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    reelButtonText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "800",
    },
    reelButtonTextActive: {
      color: colors.white,
    },
    playButton: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      ...shadow.floating,
    },
    pickerBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      marginBottom: spacing.md,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.cardSoft,
    },
    pickerCount: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "900",
    },
    pickerHint: {
      marginTop: 2,
      color: colors.muted,
      fontSize: 10,
      fontWeight: "700",
    },
    renderButton: {
      minHeight: 38,
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      borderRadius: radii.sm,
      backgroundColor: colors.primary,
    },
    renderButtonText: {
      color: colors.white,
      fontSize: 11,
      fontWeight: "900",
    },
    disabled: {
      opacity: 0.42,
    },
    reelStatus: {
      gap: spacing.sm,
      marginBottom: spacing.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: radii.md,
      backgroundColor: colors.cardSoft,
    },
    reelStatusTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    reelStatusTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "900",
    },
    reelPercent: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: "900",
    },
    progressTrack: {
      height: 4,
      overflow: "hidden",
      borderRadius: 2,
      backgroundColor: colors.surface,
    },
    progressFill: {
      height: "100%",
      borderRadius: 2,
      backgroundColor: colors.primary,
    },
    reelStatusCopy: {
      color: colors.muted,
      fontSize: 11,
      lineHeight: 16,
      fontWeight: "700",
    },
    shareButton: {
      minHeight: 38,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radii.sm,
      backgroundColor: colors.primary,
    },
    shareButtonText: {
      color: colors.white,
      fontSize: 12,
      fontWeight: "900",
    },
    pickCard: {
      position: "relative",
      borderWidth: 2,
      borderColor: "transparent",
      borderRadius: radii.md,
      marginBottom: 2,
    },
    pickCardSelected: {
      borderColor: colors.primary,
      backgroundColor: alpha(colors.primary, 0.08),
    },
    pickBadge: {
      position: "absolute",
      zIndex: 3,
      top: 6,
      left: 6,
      width: 24,
      height: 24,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      backgroundColor: colors.primary,
    },
    pickBadgeText: {
      color: colors.white,
      fontSize: 11,
      fontWeight: "900",
    },
    emptyContainer: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.xxl,
      gap: spacing.sm,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "800",
      marginTop: spacing.sm,
    },
    emptySubtitle: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "600",
    },
  });
