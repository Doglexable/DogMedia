import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { mediaThumbnailUrl } from "../api";
import { colors, radii, shadow, spacing } from "../theme";
import { formatDuration, getMediaFolderName, getMediaLabel } from "../utils/media";

export function MediaCard({ compact = false, item, liked = false, onPress, onQueue, onToggleLike }) {
  const audio = item.mime_type?.startsWith("audio/");

  return (
    <Pressable style={({ pressed }) => [styles.card, compact && styles.compactCard, pressed && styles.pressed]} onPress={() => onPress?.(item)}>
      <Image source={{ uri: mediaThumbnailUrl(item.id) }} style={[styles.cover, compact && styles.compactCover]} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={compact ? 1 : 2}>{item.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>{item.artists || getMediaFolderName(item)}</Text>
        <View style={styles.footer}>
          <Text style={styles.kind}>{getMediaLabel(item.mime_type)}</Text>
          <Text style={styles.duration}>{formatDuration(item.duration)}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        {audio && (
          <Pressable hitSlop={10} onPress={() => onToggleLike?.(item)}>
            <Text style={[styles.actionText, liked && styles.actionActive]}>{liked ? "Saved" : "Save"}</Text>
          </Pressable>
        )}
        <Pressable hitSlop={10} onPress={() => onQueue?.(item)}>
          <Text style={styles.actionText}>Queue</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 172,
    minHeight: 248,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.card,
    gap: spacing.md,
    ...shadow.soft,
  },
  compactCard: {
    width: 132,
    minHeight: 196,
  },
  pressed: {
    opacity: 0.76,
    transform: [{ scale: 0.98 }],
  },
  cover: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  compactCover: {
    borderRadius: radii.sm,
  },
  copy: {
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 19,
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  kind: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  duration: {
    color: colors.subtle,
    fontSize: 11,
    fontWeight: "800",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: "auto",
  },
  actionText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
  },
  actionActive: {
    color: colors.primary,
  },
});
