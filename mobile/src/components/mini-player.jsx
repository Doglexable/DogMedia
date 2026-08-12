import { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaThumbnailUrl } from "../api";
import { radii, shadow, spacing, useTheme } from "../theme";
import { formatDuration, getArtistLabel } from "../utils/media";
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

  return (
    <Pressable style={[styles.bar, { bottom: 72 + insets.bottom }]} onPress={openPlayer}>
      <Image source={{ uri: mediaThumbnailUrl(media.id) }} style={styles.cover} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>{media.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>{getArtistLabel(media.artists)} · {formatDuration(player.position)}</Text>
      </View>
      <PlayerTransportControls
        player={player}
        playButtonStyle={styles.play}
        playIconSize={20}
        stopPropagation
        style={styles.controls}
        transportButtonStyle={styles.transport}
        transportIconSize={18}
      />
    </Pressable>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 6,
    borderRadius: radii.md,
    backgroundColor: colors.card,
    ...shadow.soft,
  },
  cover: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  meta: {
    marginTop: 1,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  transport: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
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
});
