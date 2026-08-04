import { useMemo } from "react";
import { ScrollView, Pressable, StyleSheet, Text } from "react-native";
import { radii, spacing, useTheme } from "../theme";

export function CategoryChips({ categories, selectedId, onSelect }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <Pressable style={[styles.chip, !selectedId && styles.active]} onPress={() => onSelect(null)}>
        <Text style={[styles.label, !selectedId && styles.activeLabel]}>All</Text>
      </Pressable>
      {categories.map((category) => {
        const active = String(category.id) === String(selectedId);
        return (
          <Pressable key={category.id} style={[styles.chip, active && styles.active]} onPress={() => onSelect(category.id)}>
            <Text style={[styles.label, active && styles.activeLabel]} numberOfLines={1}>{category.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  chip: {
    maxWidth: 160,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.card,
  },
  active: {
    backgroundColor: colors.primary,
  },
  label: {
    color: colors.muted,
    fontWeight: "900",
    fontSize: 12,
  },
  activeLabel: {
    color: colors.white,
  },
});
