import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { alpha, spacing, useTheme } from "../theme";

export function PlayerIconButton({
  accessibilityLabel,
  active = false,
  disabled = false,
  icon,
  iconColor,
  onPress,
  size = 22,
  stopPropagation = false,
  style,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const handlePress = (event) => {
    if (stopPropagation) event.stopPropagation();
    onPress?.(event);
  };

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      hitSlop={10}
      onPress={handlePress}
      style={[styles.iconButton, active && styles.iconButtonActive, disabled && styles.disabled, style]}
    >
      <Ionicons name={icon} size={size} color={iconColor || (active ? colors.primary : colors.white)} />
    </Pressable>
  );
}

export function PlayerTransportControls({
  player,
  playButtonStyle,
  playIconColor,
  playIconSize = 24,
  stopPropagation = false,
  style,
  transportButtonStyle,
  transportIconSize = 22,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={[styles.transportControls, style]}>
      <PlayerIconButton
        accessibilityLabel="Previous"
        disabled={!player.hasPrev}
        icon="play-skip-back"
        onPress={() => player.advance("prev")}
        size={transportIconSize}
        stopPropagation={stopPropagation}
        style={transportButtonStyle}
      />
      <PlayerIconButton
        accessibilityLabel={player.paused ? "Play" : "Pause"}
        icon={player.paused ? "play" : "pause"}
        iconColor={playIconColor}
        onPress={player.togglePlayback}
        size={playIconSize}
        stopPropagation={stopPropagation}
        style={playButtonStyle}
      />
      <PlayerIconButton
        accessibilityLabel="Next"
        disabled={!player.hasNext}
        icon="play-skip-forward"
        onPress={() => player.advance("next")}
        size={transportIconSize}
        stopPropagation={stopPropagation}
        style={transportButtonStyle}
      />
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  iconButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  iconButtonActive: {
    backgroundColor: alpha(colors.primary, 0.18),
  },
  disabled: {
    opacity: 0.28,
  },
  transportControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
});
