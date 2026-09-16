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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
            style={[styles.pill, active && styles.activePill]}
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

const makeStyles = (colors) => StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingRight: spacing.lg,
    paddingVertical: 4,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: "rgba(255, 255, 255, 0.09)",
  },
  activePill: {
    backgroundColor: colors?.white || "#ffffff",
  },
  label: {
    color: colors?.white || "#ffffff",
    fontWeight: "600",
    fontSize: 13,
  },
  activeLabel: {
    color: "#000000",
    fontWeight: "700",
  },
});

export default MediaTypePills;
