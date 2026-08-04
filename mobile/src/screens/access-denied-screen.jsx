import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { API_BASE } from "../api";
import { spacing, useTheme } from "../theme";

export function AccessDeniedScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Access denied</Text>
      <Text style={styles.copy}>This device IP is not whitelisted for DogMedia.</Text>
      <Text style={styles.hint}>Server: {API_BASE}</Text>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
  },
  copy: {
    marginTop: spacing.md,
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
  },
  hint: {
    marginTop: spacing.xl,
    color: colors.subtle,
    fontSize: 12,
    fontWeight: "800",
  },
});
