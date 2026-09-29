import { useMemo } from "react";
import { ScrollView, Pressable, StyleSheet, Text } from "react-native";
import { spacing, useTheme } from "../theme";

export const MEDIA_TYPE_OPTIONS = [
  { id: "all", label: "All" },
  { id: "audio", label: "Music" },
  { id: "video", label: "Video" },
  { id: "photo", label: "Photo" },
];

export function MediaTypePills({ value = "all", onChange }) {
  const { colors, shadow } = useTheme();
  const styles = useMemo(() => makeStyles(colors, shadow), [colors, shadow]);
  const current = value || "all";

  const handlePress = (id) => {
    if (current === id && id !== "all") {
      onChange?.("all");
    } else {
      onChange?.(id);
    }
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.row}
    >
      {MEDIA_TYPE_OPTIONS.map((opt) => {
        const active = current === opt.id;
        return (
          <Pressable
            key={opt.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${opt.label} filter`}
            style={({ pressed }) => [
              styles.pill,
              active && styles.activePill,
              pressed && styles.pressed,
            ]}
            onPress={() => handlePress(opt.id)}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (colors, shadow) => StyleSheet.create({
  container: {
    marginHorizontal: -spacing.lg,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 4,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 9999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  activePill: {
    backgroundColor: colors.text,
    borderColor: colors.text,
    ...shadow?.soft,
  },
  label: {
    color: colors.muted,
    fontWeight: "600",
    fontSize: 13,
  },
  activeLabel: {
    color: colors.bg,
    fontWeight: "700",
  },
  pressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.88,
  },
});

export default MediaTypePills;
