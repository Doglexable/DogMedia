import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { mediaThumbnailUrl } from "../api";
import { colors, radii, shadow, spacing } from "../theme";
import { formatDuration, getArtistLabel } from "../utils/media";
import { usePlayer } from "../context/player-context";

export function MiniPlayer({ navigation }) {
  const player = usePlayer();
  const media = player?.currentMedia;
  if (!media) return null;

  return (
    <Pressable style={styles.bar} onPress={() => navigation.navigate("Player")}>
      <Image source={{ uri: mediaThumbnailUrl(media.id) }} style={styles.cover} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>{media.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>{getArtistLabel(media.artists)} · {formatDuration(player.position)}</Text>
      </View>
      <Pressable style={styles.play} onPress={player.togglePlayback}>
        <Text style={styles.playText}>{player.paused ? "Play" : "Pause"}</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: 86,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
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
  play: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
  },
  playText: {
    color: colors.white,
    fontWeight: "900",
    fontSize: 12,
  },
});
