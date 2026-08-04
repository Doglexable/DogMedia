import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMemo, useState } from "react";
import { mediaThumbnailUrl } from "../api";
import { alpha, radii, shadow, spacing, useTheme } from "../theme";
import { formatDuration, getMediaFolderName, getMediaLabel } from "../utils/media";

function QueueSheetAction({ colors, icon, label, onPress, styles }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={(event) => {
        event.stopPropagation();
        onPress?.();
      }}
      style={styles.sheetAction}
    >
      <View style={styles.sheetActionIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={styles.sheetActionText}>{label}</Text>
    </Pressable>
  );
}

export function MediaCard({ compact = false, item, liked = false, onPlayNext, onPress, onQueue, onToggleLike }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const audio = item.mime_type?.startsWith("audio/");
  const hasQueueActions = Boolean(onPlayNext || onQueue);

  const handleAction = (event, action) => {
    event.stopPropagation();
    Promise.resolve(action?.(item)).catch(() => {});
  };

  const runSheetAction = (action) => {
    setSheetError("");
    Promise.resolve(action?.(item))
      .then(() => setSheetOpen(false))
      .catch(() => setSheetError("Could not update queue."));
  };

  return (
    <>
      <Pressable
        accessibilityHint={hasQueueActions ? "Long press for queue actions" : undefined}
        onLongPress={hasQueueActions ? () => setSheetOpen(true) : undefined}
        onPress={() => onPress?.(item)}
        style={({ pressed }) => [styles.card, compact && styles.compactCard, pressed && styles.pressed]}
      >
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
            <Pressable
              accessibilityLabel={liked ? "Remove from favorites" : "Add to favorites"}
              accessibilityRole="button"
              accessibilityState={{ selected: liked }}
              hitSlop={10}
              onPress={(event) => handleAction(event, onToggleLike)}
              style={[styles.actionButton, liked && styles.actionActive]}
            >
              <Ionicons name={liked ? "bookmark" : "bookmark-outline"} size={18} color={liked ? colors.primary : colors.muted} />
            </Pressable>
          )}
        </View>
      </Pressable>

      <Modal animationType="fade" onRequestClose={() => setSheetOpen(false)} transparent visible={sheetOpen}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="Close queue actions"
            accessibilityRole="button"
            onPress={() => setSheetOpen(false)}
            style={styles.backdrop}
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <View style={styles.sheetCopy}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.sheetMeta} numberOfLines={1}>{getMediaLabel(item.mime_type)} · {formatDuration(item.duration)}</Text>
              </View>
              <Pressable accessibilityLabel="Close queue actions" accessibilityRole="button" hitSlop={10} onPress={() => setSheetOpen(false)} style={styles.closeButton}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>
            {sheetError && <Text style={styles.sheetError}>{sheetError}</Text>}
            {onPlayNext && <QueueSheetAction colors={colors} icon="play-skip-forward" label="Play next" onPress={() => runSheetAction(onPlayNext)} styles={styles} />}
            {onQueue && <QueueSheetAction colors={colors} icon="list" label="Add to queue" onPress={() => runSheetAction(onQueue)} styles={styles} />}
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (colors) => StyleSheet.create({
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
  actionButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: colors.cardSoft,
  },
  actionActive: {
    backgroundColor: alpha(colors.primary, 0.18),
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  sheet: {
    marginHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: colors.card,
    ...shadow.soft,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    marginBottom: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.cardSoft,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sheetCopy: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  sheetMeta: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: colors.cardSoft,
  },
  sheetError: {
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.warningBg,
    color: colors.warningText,
    fontSize: 12,
    fontWeight: "800",
  },
  sheetAction: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  sheetActionIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: alpha(colors.primary, 0.16),
  },
  sheetActionText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
});
