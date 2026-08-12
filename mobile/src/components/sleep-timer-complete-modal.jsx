import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { alpha, radii, shadow, spacing, useTheme } from "../theme";

export function SleepTimerCompleteModal({ canResume, mediaTitle, onDismiss, onResume, visible }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View accessibilityViewIsModal style={styles.overlay}>
        <View style={styles.dialog}>
          <View style={styles.icon}>
            <Ionicons color={colors.primary} name="moon" size={28} />
          </View>
          <Text style={styles.kicker}>Sleep timer</Text>
          <Text accessibilityRole="header" style={styles.title}>Playback paused</Text>
          <Text style={styles.description}>
            {mediaTitle
              ? `${mediaTitle} is still ready at the same position.`
              : "Your media is still ready at the same position."}
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={onDismiss}
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            >
              <Text style={styles.buttonText}>Keep paused</Text>
            </Pressable>
            {canResume && (
              <Pressable
                accessibilityRole="button"
                onPress={onResume}
                style={({ pressed }) => [styles.button, styles.primaryButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.primaryButtonText}>Resume</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: "rgba(9,9,11,0.72)",
  },
  dialog: {
    width: "100%",
    maxWidth: 390,
    alignItems: "center",
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: alpha(colors.text, 0.1),
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    ...shadow.soft,
  },
  icon: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: alpha(colors.primary, 0.24),
    borderRadius: 29,
    backgroundColor: alpha(colors.primary, 0.13),
  },
  kicker: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  title: {
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "900",
    textAlign: "center",
  },
  description: {
    marginTop: spacing.sm,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    textAlign: "center",
  },
  actions: {
    width: "100%",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  button: {
    minHeight: 46,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: alpha(colors.text, 0.12),
    borderRadius: radii.md,
    backgroundColor: colors.cardSoft,
  },
  primaryButton: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  buttonPressed: {
    opacity: 0.76,
  },
  buttonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "900",
  },
});
