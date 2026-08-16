import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { mediaThumbnailUrl } from "../api";
import { alpha, radii, spacing, useTheme } from "../theme";
import { formatDuration, getArtistLabel, getPlaybackProgress } from "../utils/media";
import { usePlayer } from "../context/player-context";
import { useOffline } from "../context/offline-context";
import { PlayerTransportControls } from "./player-controls";

export const MINI_PLAYER_HEIGHT = 48;
export const MINI_PLAYER_CLEARANCE = MINI_PLAYER_HEIGHT + spacing.md * 2;

export function MiniPlayer({ navigation }) {
  const player = usePlayer();
  const offline = useOffline();
  const { colors, shadow } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow]);
  const media = player?.currentMedia;
  if (!media) return null;

  const openPlayer = () => (navigation.getParent?.() || navigation).navigate("Player");
  const progress = getPlaybackProgress(player.position, player.duration);

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
          <Text style={styles.meta} numberOfLines={1}>{getArtistLabel(media.artists)} · {formatDuration(player.position)}</Text>
        </View>
        <PlayerTransportControls
          player={player}
          playButtonStyle={styles.play}
          playIconSize={18}
          stopPropagation
          style={styles.controls}
          transportButtonStyle={styles.transport}
          transportIconSize={16}
        />
        <View pointerEvents="none" style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors, shadow) => StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
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
    gap: spacing.sm,
    paddingHorizontal: 4,
    paddingBottom: 2,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: alpha(colors.text, 0.08),
    borderRadius: radii.lg,
    backgroundColor: colors.card,
  },
  cover: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: "900",
  },
  meta: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "700",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  transport: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.cardSoft,
  },
  play: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
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
