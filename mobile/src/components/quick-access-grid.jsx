import { useMemo } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { mediaThumbnailUrl } from "../api";
import { alpha, radii, spacing, useTheme } from "../theme";

export function QuickAccessTile({ isCurrent = false, isPaused = false, item, onPress }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!item) return null;

  return (
    <Pressable
      accessibilityLabel={`Play ${item.title}`}
      accessibilityRole="button"
      onPress={() => onPress?.(item)}
      style={({ pressed }) => [
        styles.tile,
        isCurrent && styles.tileActive,
        pressed && styles.tilePressed,
      ]}
    >
      <Image
        cachePolicy="memory-disk"
        contentFit="cover"
        source={{ uri: mediaThumbnailUrl(item.id) }}
        style={styles.thumbnail}
      />
      <View style={styles.copy}>
        <Text numberOfLines={2} style={[styles.title, isCurrent && styles.titleActive]}>
          {item.title}
        </Text>
      </View>
      {isCurrent ? (
        <View style={styles.activeIndicator}>
          <Ionicons
            color={colors.primary}
            name={isPaused ? "pause" : "volume-high"}
            size={16}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

export function QuickAccessGrid({ currentMediaId, isPaused = false, items = [], onPlay }) {
  if (!items || items.length === 0) return null;
  const displayItems = items.slice(0, 8);

  return (
    <View style={gridStyles.grid}>
      {displayItems.map((item) => (
        <View key={`quick-tile-${item.id}`} style={gridStyles.column}>
          <QuickAccessTile
            isCurrent={Number(currentMediaId) === Number(item.id)}
            isPaused={isPaused}
            item={item}
            onPress={onPlay}
          />
        </View>
      ))}
    </View>
  );
}

const gridStyles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  column: {
    width: "48.5%",
    flexGrow: 1,
  },
});

const makeStyles = (colors) =>
  StyleSheet.create({
    tile: {
      height: 56,
      flexDirection: "row",
      alignItems: "center",
      borderRadius: radii.sm,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      overflow: "hidden",
    },
    tileActive: {
      borderColor: alpha(colors.primary, 0.45),
      backgroundColor: alpha(colors.primary, 0.12),
    },
    tilePressed: {
      opacity: 0.8,
      transform: [{ scale: 0.98 }],
    },
    thumbnail: {
      width: 56,
      height: 56,
      backgroundColor: colors.surface,
    },
    copy: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: spacing.sm,
      justifyContent: "center",
    },
    title: {
      color: colors.text,
      fontSize: 12,
      lineHeight: 15,
      fontWeight: "700",
    },
    titleActive: {
      color: colors.primary,
      fontWeight: "800",
    },
    activeIndicator: {
      paddingRight: spacing.sm,
      alignItems: "center",
      justifyContent: "center",
    },
  });
