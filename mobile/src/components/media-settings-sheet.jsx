import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { alpha, radii, spacing, useTheme } from "../theme";

const TABS = [
  { id: "quality", label: "Quality" },
  { id: "speed", label: "Speed" },
  { id: "timer", label: "Sleep Timer" },
];
const QUALITY_OPTIONS = [
  { value: "ori", label: "Very High", detail: "Original file" },
  { value: "high", label: "High", detail: "High quality" },
  { value: "med", label: "Medium", detail: "Balanced" },
  { value: "low", label: "Low", detail: "Save data" },
];
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const TIMER_OPTIONS = [5, 15, 30, 45, 60];

function qualityBadge(value, media) {
  const variant = media?.encoding_status?.[value];
  const bitrate = Number(variant?.bitrate);
  if (bitrate > 0) {
    const bitrateLabel = bitrate >= 1_000_000
      ? `${Number((bitrate / 1_000_000).toFixed(1))} Mbps`
      : `${Math.round(bitrate / 1000)} kbps`;
    return media?.mime_type?.startsWith("video/") && variant.height
      ? `${variant.height}p · ${bitrateLabel}`
      : bitrateLabel;
  }
  if (value === "ori") return "SOURCE";
  if (media?.mime_type?.startsWith("video/")) return { high: "≤1080p", med: "≤720p", low: "≤480p" }[value];
  if (media?.mime_type?.startsWith("audio/")) return { high: "~256 kbps", med: "~160 kbps", low: "~96 kbps" }[value];
  return value.toUpperCase();
}

function remainingLabel(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function MediaSettingsSheet({ visible, onClose, player }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [tab, setTab] = useState("quality");

  useEffect(() => {
    if (visible) setTab("quality");
  }, [visible]);

  const available = Array.isArray(player?.currentMedia?.available_qualities)
    ? player.currentMedia.available_qualities
    : [player?.actualQuality || "ori"];
  const visibleQualities = QUALITY_OPTIONS.filter((option) => available.includes(option.value));

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="Close playback settings" onPress={onClose} style={styles.backdrop} />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.kicker}>PLAYER</Text>
              <Text style={styles.title}>Playback Settings</Text>
            </View>
            <Pressable accessibilityLabel="Close playback settings" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.tabs}>
            {TABS.map((item) => (
              <Pressable
                accessibilityLabel={item.label}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === item.id }}
                key={item.id}
                onPress={() => setTab(item.id)}
                style={[styles.tab, tab === item.id && styles.tabActive]}
              >
                <Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
            {tab === "quality" && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>STREAM QUALITY</Text>
                {visibleQualities.map((option) => (
                  <Pressable
                    accessibilityLabel={`${option.label} quality`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: player.quality === option.value }}
                    key={option.value}
                    onPress={() => player.changeQuality(option.value)}
                    style={[styles.option, player.quality === option.value && styles.optionActive]}
                  >
                    <View style={styles.optionCopy}>
                      <Text style={styles.optionTitle}>{option.label}</Text>
                      <Text style={styles.optionDetail}>{option.detail}</Text>
                    </View>
                    <Text style={styles.badge}>{qualityBadge(option.value, player.currentMedia)}</Text>
                  </Pressable>
                ))}
                {visibleQualities.length === 0 && <Text style={styles.hint}>Preparing quality options…</Text>}
                {player.actualQuality && player.actualQuality !== player.quality && (
                  <Text style={styles.hint}>Playing {player.actualQuality.toUpperCase()} while {player.quality.toUpperCase()} is requested.</Text>
                )}
              </View>
            )}

            {tab === "speed" && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>PLAYBACK SPEED</Text>
                <View style={styles.grid}>
                  {SPEED_OPTIONS.map((rate) => (
                    <Pressable
                      accessibilityLabel={`${rate}x playback speed`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: player.playbackRate === rate }}
                      key={rate}
                      onPress={() => player.setPlaybackRate(rate)}
                      style={[styles.pill, player.playbackRate === rate && styles.pillActive]}
                    >
                      <Text style={[styles.pillText, player.playbackRate === rate && styles.pillTextActive]}>{rate}x{rate === 1 ? " · Normal" : ""}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {tab === "timer" && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>SLEEP TIMER</Text>
                {player.sleepTimerRemaining > 0 && (
                  <View style={styles.countdown}>
                    <Text style={styles.countdownLabel}>TIME REMAINING</Text>
                    <Text style={styles.countdownValue}>{remainingLabel(player.sleepTimerRemaining)}</Text>
                  </View>
                )}
                <View style={styles.grid}>
                  {TIMER_OPTIONS.map((minutes) => (
                    <Pressable
                      accessibilityLabel={`Set sleep timer for ${minutes} minutes`}
                      accessibilityRole="button"
                      key={minutes}
                      onPress={() => player.setSleepTimer(minutes)}
                      style={styles.pill}
                    >
                      <Text style={styles.pillText}>{minutes}m</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable accessibilityLabel="Turn off sleep timer" accessibilityRole="button" onPress={() => player.setSleepTimer(0)} style={styles.clearButton}>
                  <Text style={styles.clearText}>Turn off timer</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default MediaSettingsSheet;

const makeStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: alpha(colors.black, 0.64) },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl, maxHeight: "82%" },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.cardBorderStrong, alignSelf: "center", marginBottom: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.lg },
  kicker: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 3 },
  closeButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radii.full, backgroundColor: colors.cardSoft },
  closeText: { color: colors.text, fontSize: 16, fontWeight: "800" },
  tabs: { flexDirection: "row", gap: spacing.xs, marginBottom: spacing.md },
  tab: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radii.sm, backgroundColor: colors.cardSoft },
  tabActive: { backgroundColor: alpha(colors.primary, 0.14) },
  tabText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  tabTextActive: { color: colors.primary },
  scroll: { flexGrow: 0 },
  content: { paddingBottom: spacing.md },
  section: { gap: spacing.sm },
  sectionTitle: { color: colors.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.1, marginBottom: spacing.xs },
  option: { minHeight: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  optionActive: { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.09) },
  optionCopy: { flex: 1 },
  optionTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  optionDetail: { color: colors.muted, fontSize: 11, fontWeight: "600", marginTop: 2 },
  badge: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pill: { minWidth: "30%", minHeight: 46, flexGrow: 1, alignItems: "center", justifyContent: "center", borderRadius: radii.sm, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, paddingHorizontal: spacing.sm },
  pillActive: { borderColor: colors.primary, backgroundColor: alpha(colors.primary, 0.09) },
  pillText: { color: colors.text, fontSize: 13, fontWeight: "800" },
  pillTextActive: { color: colors.primary },
  countdown: { alignItems: "center", paddingVertical: spacing.lg, borderRadius: radii.md, backgroundColor: alpha(colors.primary, 0.1), marginBottom: spacing.sm },
  countdownLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  countdownValue: { color: colors.primary, fontSize: 28, fontWeight: "900", marginTop: 4 },
  clearButton: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.sm, borderWidth: 1, borderColor: colors.cardBorder, marginTop: spacing.sm },
  clearText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
});
