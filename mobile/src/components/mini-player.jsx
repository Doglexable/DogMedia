import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaThumbnailUrl } from "../api";
import { alpha, radii, shadow, spacing, useTheme } from "../theme";
import { formatDuration, getArtistLabel, getPlaybackProgress } from "../utils/media";
import { usePlayer } from "../context/player-context";
import { PlayerTransportControls } from "./player-controls";

export function MiniPlayer({ navigation }) {
  const player = usePlayer();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const media = player?.currentMedia;
  if (!media) return null;

  const openPlayer = () => (navigation.getParent?.() || navigation).navigate("Player");
  const progress = getPlaybackProgress(player.position, player.duration);

  return (
    <View style={[styles.bar, { bottom: 80 + insets.bottom }]}>
      <Pressable
        accessibilityLabel={`Open player for ${media.title}, ${Math.round(progress * 100)}% played`}
        accessibilityRole="button"
        onPress={openPlayer}
        style={styles.surface}
      >
        <Image source={{ uri: mediaThumbnailUrl(media.id) }} style={styles.cover} />
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>{media.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>{getArtistLabel(media.artists)} · {formatDuration(player.position)}</Text>
        </View>
        <PlayerTransportControls
          player={player}
          playButtonStyle={styles.play}
          playIconSize={16}
          stopPropagation
          style={styles.controls}
          transportButtonStyle={styles.transport}
          transportIconSize={14}
        />
        <View pointerEvents="none" style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    height: 40,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    ...shadow.soft,
  },
  surface: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
    paddingBottom: 2,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: alpha(colors.text, 0.08),
    borderRadius: radii.lg,
    backgroundColor: colors.card,
  },
  cover: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 15,
    fontWeight: "900",
  },
  meta: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  transport: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: colors.cardSoft,
  },
  play: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
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
