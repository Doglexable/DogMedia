import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaThumbnailUrl } from "../api";
import { colors, radii, shadow, spacing } from "../theme";
import { formatDuration, getArtistLabel } from "../utils/media";
import { usePlayer } from "../context/player-context";
import { PlayerTransportControls } from "./player-controls";

export function MiniPlayer({ navigation }) {
  const player = usePlayer();
  const insets = useSafeAreaInsets();
  const media = player?.currentMedia;
  if (!media) return null;

  return (
    <Pressable style={[styles.bar, { bottom: 72 + insets.bottom }]} onPress={() => navigation.navigate("Player")}>
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

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: "rgba(25,25,34,0.96)",
    ...shadow.soft,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontWeight: "900",
  },
  meta: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  transport: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  play: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: colors.primary,
  },
});
