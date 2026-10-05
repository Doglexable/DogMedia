import { useMemo } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { mediaThumbnailUrl } from "../api";
import { alpha, radii, spacing, useTheme } from "../theme";
import { formatDuration, getPlaybackProgress, resolveMediaArtist } from "../utils/media";
import { usePlayer } from "../context/player-context";
import { useOffline } from "../context/offline-context";
import { PlayerTransportControls } from "./player-controls";

export const MINI_PLAYER_HEIGHT = 54;
export const MINI_PLAYER_CLEARANCE = MINI_PLAYER_HEIGHT + spacing.md * 2;

export function MiniPlayer({ navigation }) {
  const player = usePlayer();
  const offline = useOffline();
  const { colors, shadow } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const isCompact = windowWidth < 360;
  const styles = useMemo(() => makeStyles(colors, shadow, isCompact), [colors, shadow, isCompact]);
  const media = player?.currentMedia;
  if (!media || !media.mime_type?.startsWith("audio/")) return null;

  const openPlayer = () => (navigation.getParent?.() || navigation).navigate("Player");
  const progress = getPlaybackProgress(player.position, player.duration);
  const artistText = resolveMediaArtist(media);
  const isLiked = player.isLiked ? player.isLiked(media.id) : false;

  const handleToggleLike = (event) => {
    event.stopPropagation();
    player.toggleLike?.(media).catch(() => {});
  };

  const holderLabel = player.playbackConflict?.holder?.deviceLabel || "Another device";

  return (
    <View style={[styles.bar, player.controlsLocked && styles.barWithConnect]}>
      <Pressable
        accessibilityLabel={`Open player for ${media.title}, ${Math.round(progress * 100)}% played`}
        accessibilityRole="button"
        onPress={openPlayer}
        style={[styles.surface, player.controlsLocked && styles.surfaceWithConnect]}
      >
        <Image
          source={{ uri: offline.resolveThumbnailUri(media.id) || mediaThumbnailUrl(media.id) }}
          style={styles.cover}
        />
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.title}>{media.title}</Text>
          <Text numberOfLines={1} style={styles.meta}>
            {`${artistText} · ${formatDuration(player.position)}`}
          </Text>
        </View>

        <Pressable
          accessibilityLabel={isLiked ? "Remove from favorites" : "Add to favorites"}
          accessibilityRole="button"
          hitSlop={10}
          onPress={handleToggleLike}
          style={styles.likeButton}
        >
          <Ionicons
            color={isLiked ? colors.primary : colors.muted}
            name={isLiked ? "bookmark" : "bookmark-outline"}
            size={isCompact ? 16 : 19}
          />
        </Pressable>

        <PlayerTransportControls
          playButtonStyle={styles.play}
          player={player}
          playIconColor={colors.white}
          playIconSize={isCompact ? 16 : 18}
          stopPropagation
          style={styles.controls}
          transportButtonStyle={styles.transport}
          transportIconColor={colors.text}
          transportIconSize={isCompact ? 14 : 16}
        />

        {/* Spotify Bottom Hairline Progress Indicator */}
        <View pointerEvents="none" style={[styles.progressTrack, player.controlsLocked && styles.progressTrackWithConnect]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        {/* Spotify Connect Observer Green Bar */}
        {player.controlsLocked && (
          <View style={styles.spotifyConnectBar}>
            {player.canTakeOverPlayback && (
              <Pressable
                accessibilityLabel="Move playback to this device"
                accessibilityRole="button"
                onPress={(event) => {
                  event.stopPropagation();
                  player.takeOverExclusiveSession?.().catch(() => {});
                }}
                style={styles.spotifyConnectTakeover}
              >
                <Text style={styles.spotifyConnectTakeoverText}>Play here</Text>
              </Pressable>
            )}
            <View style={styles.spotifyConnectInfo}>
              <Ionicons name="volume-high" size={12} color="#ffffff" />
              <Text numberOfLines={1} style={styles.spotifyConnectText}>
                Playing on {holderLabel}
              </Text>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const makeStyles = (colors, shadow, isCompact) =>
  StyleSheet.create({
    bar: {
      position: "absolute",
      left: isCompact ? spacing.sm : spacing.md,
      right: isCompact ? spacing.sm : spacing.md,
      bottom: spacing.md,
      height: MINI_PLAYER_HEIGHT,
      borderRadius: radii.md,
      backgroundColor: colors.card,
      ...shadow.floating,
    },
    surface: {
      height: MINI_PLAYER_HEIGHT,
      flexDirection: "row",
      alignItems: "center",
      gap: isCompact ? 6 : spacing.sm,
      paddingHorizontal: isCompact ? 6 : 8,
      paddingBottom: 2,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: radii.md,
      backgroundColor: colors.card,
    },
    cover: {
      width: isCompact ? 38 : 42,
      height: isCompact ? 38 : 42,
      borderRadius: radii.sm,
      backgroundColor: colors.surface,
    },
    copy: {
      flex: 1,
      minWidth: 0,
      justifyContent: "center",
      gap: 1,
    },
    title: {
      color: colors.text,
      fontSize: isCompact ? 13 : 14,
      lineHeight: isCompact ? 16 : 17,
      fontWeight: "800",
    },
    meta: {
      color: colors.muted,
      fontSize: isCompact ? 10 : 11,
      lineHeight: isCompact ? 13 : 14,
      fontWeight: "600",
    },
    likeButton: {
      width: isCompact ? 28 : 32,
      height: isCompact ? 28 : 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 16,
    },
    takeoverButton: {
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 6,
      backgroundColor: alpha(colors.primary, 0.14),
    },
    takeoverText: {
      color: colors.text,
      fontSize: 10,
      fontWeight: "800",
    },
    controls: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
    },
    transport: {
      width: isCompact ? 28 : 32,
      height: isCompact ? 28 : 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: isCompact ? 14 : 16,
      backgroundColor: colors.cardSoft,
    },
    play: {
      width: isCompact ? 32 : 36,
      height: isCompact ? 32 : 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: isCompact ? 16 : 18,
      backgroundColor: colors.primary,
    },
    progressTrack: {
      position: "absolute",
      right: 0,
      bottom: 0,
      left: 0,
      height: 2.5,
      backgroundColor: alpha(colors.text, 0.08),
    },
    progressTrackWithConnect: {
      bottom: 22,
    },
    progressFill: {
      height: "100%",
      backgroundColor: colors.primary,
    },
    barWithConnect: {
      height: MINI_PLAYER_HEIGHT + 22,
    },
    surfaceWithConnect: {
      height: MINI_PLAYER_HEIGHT + 22,
      paddingBottom: 22,
    },
    spotifyConnectBar: {
      position: "absolute",
      right: 0,
      bottom: 0,
      left: 0,
      height: 22,
      backgroundColor: colors.primary,
      borderBottomLeftRadius: radii.md - 1,
      borderBottomRightRadius: radii.md - 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      paddingHorizontal: 10,
      gap: 6,
    },
    spotifyConnectInfo: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    spotifyConnectText: {
      color: "#ffffff",
      fontSize: 10.5,
      fontWeight: "800",
      letterSpacing: -0.1,
    },
    spotifyConnectTakeover: {
      marginRight: "auto",
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.45)",
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 1,
      backgroundColor: "rgba(255, 255, 255, 0.18)",
    },
    spotifyConnectTakeoverText: {
      color: "#ffffff",
      fontSize: 9.5,
      fontWeight: "800",
    },
  });
