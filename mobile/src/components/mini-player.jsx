import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { mediaThumbnailUrl } from "../api";
import { alpha, radii, spacing, useTheme } from "../theme";
import { formatDuration, getPlaybackProgress, resolveMediaArtist } from "../utils/media";
import { usePlayer } from "../context/player-context";
import { useOffline } from "../context/offline-context";
import { PlayerTransportControls } from "./player-controls";

export const MINI_PLAYER_HEIGHT = 48;
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

  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityLabel={`Open player for ${media.title}, ${Math.round(progress * 100)}% played`}
        accessibilityRole="button"
        onPress={openPlayer}
        style={styles.surface}
      >
        <Image source={{ uri: offline.resolveThumbnailUri(media.id) || mediaThumbnailUrl(media.id) }} style={styles.cover} />
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>{media.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{artistText} · {formatDuration(player.position)}</Text>
        </View>
        <PlayerTransportControls
          player={player}
          playButtonStyle={styles.play}
          playIconSize={isCompact ? 16 : 18}
          stopPropagation
          style={styles.controls}
          transportButtonStyle={styles.transport}
          transportIconSize={isCompact ? 14 : 16}
        />
        <View pointerEvents="none" style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors, shadow, isCompact) => StyleSheet.create({
  bar: {
    position: "absolute",
    left: isCompact ? spacing.sm : spacing.md,
    right: isCompact ? spacing.sm : spacing.md,
    bottom: spacing.md,
    height: MINI_PLAYER_HEIGHT,
    borderRadius: radii.lg,
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
    borderColor: alpha(colors.text, 0.08),
    borderRadius: radii.lg,
    backgroundColor: colors.card,
  },
  cover: {
    width: isCompact ? 34 : 40,
    height: isCompact ? 34 : 40,
    borderRadius: isCompact ? 8 : 10,
    backgroundColor: colors.surface,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  title: {
    color: colors.text,
    fontSize: isCompact ? 13 : 14,
    lineHeight: isCompact ? 16 : 17,
    fontWeight: "900",
  },
  meta: {
    color: colors.muted,
    fontSize: isCompact ? 10 : 11,
    lineHeight: isCompact ? 12 : 13,
    fontWeight: "700",
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
    height: 2,
    backgroundColor: alpha(colors.text, 0.08),
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.primary,
  },
});
