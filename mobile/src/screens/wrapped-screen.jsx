import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../api";
import { colors, radii, spacing } from "../theme";
import { formatDuration } from "../utils/media";

const DAY_MS = 86400000;

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function daysRemaining(seconds) {
  const days = Math.max(Math.ceil(((seconds || 0) * 1000) / DAY_MS), 0);
  if (days <= 0) return "less than a day";
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function WrappedScreen({ onAccessChanged }) {
  const [data, setData] = useState(null);
  const [locked, setLocked] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const period = useMemo(() => {
    const to = new Date();
    const from = new Date(Date.now() - 29 * DAY_MS);
    return { fromIso: from.toISOString(), toIso: to.toISOString(), label: `${formatDate(from)} - ${formatDate(to)}` };
  }, []);

  const load = useCallback(() => {
    setRefreshing(true);
    setError("");
    setLocked(null);
    return api(`/api/wrapped/current?from=${period.fromIso}&to=${period.toIso}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (response.status === 429 && payload?.code === "WRAPPED_LOCKED") {
          setLocked(payload);
          setData(null);
          onAccessChanged?.();
          return;
        }
        if (!response.ok) throw new Error(payload?.error || "Could not load Wrapped.");
        setData(payload);
        onAccessChanged?.();
      })
      .catch((err) => setError(err.message || "Could not load Wrapped."))
      .finally(() => setRefreshing(false));
  }, [period.fromIso, period.toIso]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.primary} />}>
      <Text style={styles.kicker}>Wrapped</Text>
      <Text style={styles.title}>Playback pulse</Text>
      <Text style={styles.period}>{period.label}</Text>

      {error && <Text style={styles.warning}>{error}</Text>}
      {locked && (
        <View style={styles.locked}>
          <Text style={styles.lockedTitle}>Wrapped locked</Text>
          <Text style={styles.lockedCopy}>Come back {formatDate(locked.nextOpenAt)}, in about {daysRemaining(locked.retryAfterSeconds)}.</Text>
        </View>
      )}
      {data && (
        <>
          <View style={styles.metrics}>
            <View style={styles.metric}><Text style={styles.metricLabel}>Play time</Text><Text style={styles.metricValue}>{formatDuration(data.totalPlayTime)}</Text></View>
            <View style={styles.metric}><Text style={styles.metricLabel}>Plays</Text><Text style={styles.metricValue}>{data.totalPlays || 0}</Text></View>
            <View style={styles.metric}><Text style={styles.metricLabel}>Top media</Text><Text style={styles.metricValue}>{data.topMedia?.length || 0}</Text></View>
          </View>
          <Text style={styles.sectionTitle}>Top media</Text>
          {(data.topMedia || []).map((item, index) => (
            <View key={`${item.mediaId}-${index}`} style={styles.row}>
              <Text style={styles.rank}>{index + 1}</Text>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title || `Media #${item.mediaId}`}</Text>
                <Text style={styles.rowMeta}>{item.playCount || 0} plays · {formatDuration(item.totalTime)}</Text>
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingTop: 58,
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
    gap: spacing.lg,
  },
  kicker: {
    color: colors.primary,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 38,
    lineHeight: 40,
    fontWeight: "900",
  },
  period: {
    color: colors.muted,
    fontWeight: "800",
  },
  warning: {
    color: colors.warningText,
    backgroundColor: colors.warningBg,
    padding: spacing.md,
    borderRadius: radii.md,
    fontWeight: "800",
  },
  locked: {
    padding: spacing.xl,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
  },
  lockedTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  lockedCopy: {
    marginTop: spacing.sm,
    color: colors.muted,
    lineHeight: 21,
    fontWeight: "700",
  },
  metrics: {
    flexDirection: "row",
    gap: spacing.md,
  },
  metric: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.card,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricValue: {
    marginTop: spacing.sm,
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.card,
  },
  rank: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    overflow: "hidden",
    backgroundColor: colors.cardSoft,
    color: colors.text,
    textAlign: "center",
    lineHeight: 34,
    fontWeight: "900",
  },
  rowCopy: {
    flex: 1,
  },
  rowTitle: {
    color: colors.text,
    fontWeight: "900",
  },
  rowMeta: {
    marginTop: 3,
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
});
