import { useMemo, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mediaThumbnailUrl } from "../api";
import { alpha, radii, spacing, useTheme } from "../theme";
import { formatDuration, getMediaLabel, resolveMediaArtist } from "../utils/media";
import { useOffline } from "../context/offline-context";

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
        <Ionicons color={colors.primary} name={icon} size={20} />
      </View>
      <Text style={styles.sheetActionText}>{label}</Text>
    </Pressable>
  );
}

export function MediaCard({
  compact = false,
  index,
  isCurrent = false,
  isPaused = false,
  item,
  layout = "card",
  liked = false,
  onPlayNext,
  onPress,
  onQueue,
  onToggleLike,
}) {
  const { colors, shadow } = useTheme();
  const offline = useOffline();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const audio = item.mime_type?.startsWith("audio/");
  const hasQueueActions = Boolean(onPlayNext || onQueue);
  const downloaded = offline.downloadsById.get(Number(item.id));
  const downloadJob = offline.jobs.find((job) => job.mediaId === Number(item.id));
  const downloadActive = ["queued", "downloading", "paused"].includes(downloadJob?.state);

  const download = (cellularApproved = false) => offline.downloadMedia(item.id, { cellularApproved });
  const handleDownload = () => {
    if (downloaded) return offline.removeDownload(item.id);
    if (downloadActive) return offline.cancelDownload(item.id);
    if (offline.networkType === "cellular") {
      Alert.alert("Use cellular data?", "This audio download may use a large amount of mobile data.", [
        { text: "Cancel", style: "cancel" },
        { text: "Download", onPress: () => download(true).catch(() => {}) },
      ]);
      return Promise.resolve();
    }
    return download();
  };

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

  const thumbnailUri = downloaded?.thumbnailUri || mediaThumbnailUrl(item.id);

  return (
    <>
      {layout === "row" ? (
        <Pressable
          accessibilityHint={hasQueueActions ? "Long press for queue actions" : undefined}
          onLongPress={hasQueueActions ? () => setSheetOpen(true) : undefined}
          onPress={() => onPress?.(item)}
          style={({ pressed }) => [
            styles.row,
            isCurrent && styles.rowActive,
            pressed && styles.pressed,
          ]}
        >
          {index != null ? (
            <View style={styles.rowIndexContainer}>
              {isCurrent ? (
                <Ionicons
                  color={colors.primary}
                  name={isPaused ? "pause" : "volume-high"}
                  size={14}
                />
              ) : (
                <Text style={styles.rowIndexText}>{index}</Text>
              )}
            </View>
          ) : null}

          <View style={styles.rowCoverWrapper}>
            <Image
              cachePolicy="memory-disk"
              contentFit="cover"
              source={{ uri: thumbnailUri }}
              style={styles.rowCover}
            />
            {isCurrent && index == null && (
              <View style={styles.rowPlayOverlay}>
                <Ionicons
                  color={colors.primary}
                  name={isPaused ? "pause" : "volume-high"}
                  size={14}
                />
              </View>
            )}
          </View>
          <View style={styles.rowCopy}>
            <Text numberOfLines={1} style={[styles.rowTitle, isCurrent && styles.titleActive]}>
              {item.title}
            </Text>
            <Text numberOfLines={1} style={styles.rowMeta}>
              {resolveMediaArtist(item)}
              {item.category_path || item.category_name ? ` · ${item.category_path || item.category_name}` : ""}
            </Text>
          </View>
          <Text style={styles.rowDuration}>{item.duration ? formatDuration(item.duration) : "-"}</Text>
          <View style={styles.rowActions}>
            {audio && onToggleLike && (
              <Pressable
                accessibilityLabel={liked ? "Remove from favorites" : "Add to favorites"}
                accessibilityRole="button"
                accessibilityState={{ selected: liked }}
                hitSlop={10}
                onPress={(event) => handleAction(event, onToggleLike)}
                style={styles.rowActionButton}
              >
                <Ionicons
                  color={liked ? colors.primary : colors.muted}
                  name={liked ? "bookmark" : "bookmark-outline"}
                  size={18}
                />
              </Pressable>
            )}
            <Pressable
              accessibilityLabel="More options"
              accessibilityRole="button"
              hitSlop={10}
              onPress={(event) => {
                event.stopPropagation();
                setSheetOpen(true);
              }}
              style={styles.rowActionButton}
            >
              <Ionicons color={colors.muted} name="ellipsis-vertical" size={17} />
            </Pressable>
          </View>
        </Pressable>
      ) : (
        <Pressable
          accessibilityHint={hasQueueActions ? "Long press for queue actions" : undefined}
          onLongPress={hasQueueActions ? () => setSheetOpen(true) : undefined}
          onPress={() => onPress?.(item)}
          style={({ pressed }) => [
            styles.card,
            compact && styles.compactCard,
            isCurrent && styles.cardActive,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.coverWrapper}>
            <Image
              cachePolicy="memory-disk"
              contentFit="cover"
              source={{ uri: thumbnailUri }}
              style={[styles.cover, compact && styles.compactCover]}
            />
            {isCurrent && (
              <View style={styles.cardPlayBadge}>
                <Ionicons
                  color={colors.white}
                  name={isPaused ? "pause" : "volume-high"}
                  size={14}
                />
              </View>
            )}
          </View>
          <View style={styles.copy}>
            <Text numberOfLines={compact ? 1 : 2} style={[styles.title, isCurrent && styles.titleActive]}>
              {item.title}
            </Text>
            <Text numberOfLines={1} style={styles.meta}>
              {resolveMediaArtist(item)}
            </Text>
            <View style={styles.footer}>
              <Text style={styles.kind}>{getMediaLabel(item.mime_type)}</Text>
              <Text style={styles.duration}>{formatDuration(item.duration)}</Text>
            </View>
          </View>
          <View style={styles.actions}>
            {audio && onToggleLike && (
              <Pressable
                accessibilityLabel={liked ? "Remove from favorites" : "Add to favorites"}
                accessibilityRole="button"
                accessibilityState={{ selected: liked }}
                hitSlop={10}
                onPress={(event) => handleAction(event, onToggleLike)}
                style={[styles.actionButton, liked && styles.actionActive]}
              >
                <Ionicons
                  color={liked ? colors.primary : colors.muted}
                  name={liked ? "bookmark" : "bookmark-outline"}
                  size={17}
                />
              </Pressable>
            )}
            {audio && (
              <Pressable
                accessibilityLabel={downloaded ? "Remove download" : downloadActive ? "Cancel download" : "Download audio"}
                accessibilityRole="button"
                hitSlop={10}
                onPress={(event) => handleAction(event, handleDownload)}
                style={[styles.actionButton, downloaded && styles.actionActive]}
              >
                <Ionicons
                  color={downloaded ? colors.primary : colors.muted}
                  name={downloaded ? "checkmark" : downloadActive ? "close" : "download-outline"}
                  size={17}
                />
              </Pressable>
            )}
          </View>
        </Pressable>
      )}

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
                <Text numberOfLines={1} style={styles.sheetTitle}>{item.title}</Text>
                <Text numberOfLines={1} style={styles.sheetMeta}>
                  {getMediaLabel(item.mime_type)} · {formatDuration(item.duration)}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close queue actions"
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => setSheetOpen(false)}
                style={styles.closeButton}
              >
                <Ionicons color={colors.muted} name="close" size={20} />
              </Pressable>
            </View>
            {sheetError && <Text style={styles.sheetError}>{sheetError}</Text>}
            {onPlayNext && (
              <QueueSheetAction
                colors={colors}
                icon="play-skip-forward"
                label="Play next"
                onPress={() => runSheetAction(onPlayNext)}
                styles={styles}
              />
            )}
            {onQueue && (
              <QueueSheetAction
                colors={colors}
                icon="list"
                label="Add to queue"
                onPress={() => runSheetAction(onQueue)}
                styles={styles}
              />
            )}
            {audio && (
              <QueueSheetAction
                colors={colors}
                icon={downloaded ? "trash-outline" : "download-outline"}
                label={downloaded ? "Remove download" : "Download"}
                onPress={() => runSheetAction(handleDownload)}
                styles={styles}
              />
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (colors, shadow) =>
  StyleSheet.create({
    card: {
      width: 172,
      minHeight: 248,
      padding: spacing.md,
      borderRadius: radii.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      gap: spacing.md,
      ...shadow.soft,
    },
    compactCard: {
      width: 132,
      minHeight: 196,
    },
    cardActive: {
      borderColor: alpha(colors.primary, 0.45),
    },
    pressed: {
      opacity: 0.8,
      transform: [{ scale: 0.98 }],
    },
    coverWrapper: {
      position: "relative",
      width: "100%",
      aspectRatio: 1,
    },
    cover: {
      width: "100%",
      height: "100%",
      borderRadius: radii.md,
      backgroundColor: colors.surface,
    },
    compactCover: {
      borderRadius: radii.sm,
    },
    cardPlayBadge: {
      position: "absolute",
      right: spacing.xs,
      bottom: spacing.xs,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      ...shadow.floating,
    },
    copy: {
      gap: 4,
    },
    title: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "800",
      lineHeight: 18,
    },
    titleActive: {
      color: colors.primary,
    },
    meta: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "600",
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
      fontWeight: "800",
    },
    duration: {
      color: colors.subtle,
      fontSize: 11,
      fontWeight: "700",
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
      marginTop: "auto",
    },
    actionButton: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 16,
      backgroundColor: colors.cardSoft,
    },
    actionActive: {
      backgroundColor: alpha(colors.primary, 0.18),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.md,
      backgroundColor: "transparent",
    },
    rowActive: {
      backgroundColor: alpha(colors.primary, 0.10),
    },
    rowCoverWrapper: {
      position: "relative",
    },
    rowCover: {
      width: 48,
      height: 48,
      borderRadius: radii.sm,
      backgroundColor: colors.surface,
    },
    rowPlayOverlay: {
      position: "absolute",
      right: -3,
      bottom: -3,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    rowCopy: {
      flex: 1,
      minWidth: 0,
      justifyContent: "center",
      gap: 3,
    },
    rowTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },
    rowMeta: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "600",
    },
    rowIndexContainer: {
      width: 22,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 2,
    },
    rowIndexText: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: "800",
    },
    rowDuration: {
      color: colors.subtle,
      fontSize: 11,
      fontWeight: "700",
      minWidth: 32,
      textAlign: "right",
      marginRight: 2,
    },
    rowActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    rowActionButton: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 17,
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
      ...shadow.floating,
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
