import { useMemo } from "react";
import { ScrollView, Pressable, StyleSheet, Text } from "react-native";
import { radii, spacing, useTheme } from "../theme";
import { toggleCategorySelection } from "../utils/categories";

export function CategoryChips({ categories = [], selectedId, onSelect }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const handlePress = (id) => {
    onSelect?.(toggleCategorySelection(selectedId, id));
  };

  if (!categories || categories.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.container}
      contentContainerStyle={styles.row}
    >
      <Pressable
        accessibilityLabel="All categories"
        accessibilityRole="tab"
        accessibilityState={{ selected: !selectedId }}
        style={({ pressed }) => [
          styles.chip,
          !selectedId && styles.active,
          pressed && styles.pressed,
        ]}
        onPress={() => handlePress(null)}
      >
        <Text style={[styles.label, !selectedId && styles.activeLabel]}>All</Text>
      </Pressable>
      {categories.map((category) => {
        const active = String(category.id) === String(selectedId);
        return (
          <Pressable
            key={category.id}
            accessibilityLabel={`${category.name} category`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.chip,
              active && styles.active,
              pressed && styles.pressed,
            ]}
            onPress={() => handlePress(category.id)}
          >
            <Text
              numberOfLines={1}
              style={[styles.label, active && styles.activeLabel]}
            >
              {category.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  container: {
    marginHorizontal: -spacing.lg,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 2,
  },
  chip: {
    maxWidth: 160,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radii.full,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  active: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  label: {
    color: colors.muted,
    fontWeight: "800",
    fontSize: 12,
  },
  activeLabel: {
    color: colors.white,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.88,
  },
});
