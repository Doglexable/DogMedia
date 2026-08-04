import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../api";
import { colors, radii, shadow, spacing } from "../theme";

const DAY_MS = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatLongDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });
}

function formatDaysRemaining(seconds) {
  const days = Math.max(Math.ceil(((seconds || 0) * 1000) / DAY_MS), 0);
  if (days <= 0) return "less than a day";
  return `${days} day${days === 1 ? "" : "s"}`;
}

function formatUnlockMessage(locked) {
  const nextOpenDate = formatLongDate(locked?.nextOpenAt);
  if (!nextOpenDate) return "Check back later.";
  if (!locked?.retryAfterSeconds) return `Come back ${nextOpenDate}.`;
  return `Come back ${nextOpenDate}, in about ${formatDaysRemaining(locked.retryAfterSeconds)}.`;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function fmtTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!value) return "0m";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${secs}s`;
}

function getActivityLevel(value, maxValue) {
  if (!value) return 0;
  const ratio = value / Math.max(maxValue, 1);
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.45) return 3;
  if (ratio >= 0.18) return 2;
  return 1;
}

function buildHeatmapCells(timeline, maxDayTime) {
  const firstDay = timeline[0]?.dateObject?.getDay?.() || 0;
  const cells = Array.from({ length: firstDay }, () => ({ empty: true, level: 0 }));

  timeline.forEach((day) => {
    cells.push({
      ...day,
      level: getActivityLevel(day.playTime, maxDayTime),
    });
  });

  while (cells.length % 7 !== 0) {
    cells.push({ empty: true, level: 0 });
  }

  return cells;
}

function getCurrentStreak(timeline) {
  let streak = 0;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const day = timeline[index];
    if (!day || (day.playTime <= 0 && day.plays <= 0)) break;
    streak += 1;
  }
  return streak;
}

function getBusiestWeekday(timeline) {
  const totals = WEEKDAYS.map((label) => ({ label, playTime: 0, plays: 0 }));
  timeline.forEach((day) => {
    const index = day.dateObject?.getDay?.() || 0;
    totals[index].playTime += day.playTime || 0;
    totals[index].plays += day.plays || 0;
  });
  return totals.sort((a, b) => b.playTime - a.playTime || b.plays - a.plays)[0] || { label: "None", playTime: 0, plays: 0 };
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function SummaryItem({ label, value }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function SectionHeading({ detail, title, value }) {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.sectionCopy}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {detail && <Text style={styles.sectionDetail}>{detail}</Text>}
      </View>
      {value && <Text style={styles.sectionValue}>{value}</Text>}
    </View>
  );
}

function EmptyState({ copy, title }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyMark} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyCopy}>{copy}</Text>
    </View>
  );
}

function LoadingState() {
  return (
    <>
      <View style={styles.skeletonHero} />
      <View style={styles.skeletonGrid}>
        {Array.from({ length: 4 }, (_, index) => <View key={index} style={styles.skeletonMetric} />)}
      </View>
      <View style={styles.skeletonPanel} />
    </>
  );
}

function DailyPulse({ maxDayTime, timeline }) {
  return (
    <View accessibilityLabel="Daily playback time" style={styles.pulse}>
      {timeline.map((day) => {
        const pct = Math.max((day.playTime / maxDayTime) * 100, day.playTime ? 12 : 0);
        return (
          <View key={day.date} style={styles.pulseDay}>
            <View style={[styles.pulseBar, { height: `${pct}%` }]} />
          </View>
        );
      })}
    </View>
  );
}

function ActivityHeatmap({ maxDayTime, timeline }) {
  const cells = buildHeatmapCells(timeline, maxDayTime);

  return (
    <View style={styles.heatmapShell}>
      <View style={styles.heatmapRows}>
        <View style={styles.weekdayColumn}>
          {WEEKDAYS.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}
        </View>
        <View style={styles.heatmapGrid}>
          {cells.map((cell, index) => (
            <View
              key={cell.date || `empty-${index}`}
              style={[
                styles.heatmapCell,
                styles[`heatmapLevel${cell.level || 0}`],
                cell.empty && styles.heatmapEmpty,
              ]}
            />
          ))}
        </View>
      </View>
      <View style={styles.heatmapLegend}>
        <Text style={styles.legendText}>Less</Text>
        {[1, 2, 3, 4].map((level) => <View key={level} style={[styles.legendCell, styles[`heatmapLevel${level}`]]} />)}
        <Text style={styles.legendText}>More</Text>
      </View>
    </View>
  );
}

function ActivityFeed({ days, maxDayTime }) {
  if (days.length === 0) {
    return <Text style={styles.emptyNote}>Activity will appear after playback events are recorded.</Text>;
  }

  return (
    <View style={styles.feedList}>
      {days.slice(0, 8).map((day) => {
        const pct = Math.max((day.playTime / maxDayTime) * 100, 8);
        return (
          <View key={day.date} style={styles.feedRow}>
            <View style={styles.feedDate}>
              <Text style={styles.feedDay}>{day.dayName}</Text>
              <Text style={styles.feedNumber}>{new Date(day.date).getDate()}</Text>
            </View>
            <View style={styles.feedCopy}>
              <Text style={styles.feedTitle}>{formatLongDate(day.date)}</Text>
              <Text style={styles.feedMeta}>{fmtTime(day.playTime)} / {formatNumber(day.plays)} plays</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function TopMediaList({ maxMediaTime, media }) {
  if (media.length === 0) {
    return <Text style={styles.emptyNote}>Top media will appear after playback events are recorded.</Text>;
  }

  return (
    <View style={styles.mediaList}>
      {media.map((item, index) => {
        const pct = Math.max(((item.totalTime || 0) / maxMediaTime) * 100, 3);
        return (
          <View key={`${item.mediaId || "media"}-${index}`} style={styles.mediaRow}>
            <Text style={styles.rank}>{index + 1}</Text>
            <View style={styles.mediaCopy}>
              <Text style={styles.mediaTitle} numberOfLines={1}>{item.title || `Media #${item.mediaId}`}</Text>
              <Text style={styles.mediaMeta}>{formatNumber(item.playCount || 0)} plays / {fmtTime(item.totalTime || 0)}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function WrappedScreen({ onAccessChanged }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [locked, setLocked] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const period = useMemo(() => {
    const to = new Date();
    const from = new Date(Date.now() - 29 * DAY_MS);
    return {
      from,
      to,
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      label: `${formatDate(from)} - ${formatDate(to)}`,
    };
  }, []);

  const load = useCallback(() => {
    setRefreshing(true);
    setData(null);
    setError("");
    setLocked(null);
    return api(`/api/wrapped/current?from=${period.fromIso}&to=${period.toIso}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (response.status === 429 && payload?.code === "WRAPPED_LOCKED") {
          setLocked(payload);
          onAccessChanged?.();
          return;
        }
        if (!response.ok) throw new Error("Wrapped request failed.");
        setData(payload);
        onAccessChanged?.();
      })
      .catch(() => setError("Could not load wrapped data."))
      .finally(() => setRefreshing(false));
  }, [onAccessChanged, period.fromIso, period.toIso]);

  useEffect(() => {
    load();
  }, [load]);

  const timeline = useMemo(() => {
    const byDate = new Map((data?.timeline || []).map((day) => [day.date, day]));
    return Array.from({ length: 30 }, (_, index) => {
      const date = new Date(period.from.getTime() + index * DAY_MS);
      const key = date.toISOString().slice(0, 10);
      const day = byDate.get(key);
      return {
        date: key,
        dateObject: date,
        dayName: date.toLocaleDateString(undefined, { weekday: "short" }),
        playTime: day?.playTime || 0,
        plays: day?.plays || 0,
      };
    });
  }, [data, period]);

  const topMedia = data?.topMedia || [];
  const totalPlayTime = data?.totalPlayTime || 0;
  const totalPlays = data?.totalPlays || 0;
  const activeDays = timeline.filter((day) => day.playTime > 0 || day.plays > 0).length;
  const maxDayTime = Math.max(...timeline.map((day) => day.playTime), 1);
  const maxMediaTime = Math.max(...topMedia.map((media) => media.totalTime || 0), 1);
  const busiestDay = [...timeline].sort((a, b) => b.playTime - a.playTime)[0];
  const currentStreak = getCurrentStreak(timeline);
  const busiestWeekday = getBusiestWeekday(timeline);
  const listeningDensity = Math.round((activeDays / 30) * 100);
  const activityDays = timeline
    .filter((day) => day.playTime > 0 || day.plays > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  const isEmpty = !!data && totalPlayTime === 0 && totalPlays === 0 && topMedia.length === 0;
  const leadMedia = topMedia[0];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: 120 + insets.bottom }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={colors.primary} />}
      showsVerticalScrollIndicator={false}
    >
      {error ? (
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>Wrapped unavailable</Text>
          <Text style={styles.warningCopy}>{error}</Text>
        </View>
      ) : locked ? (
        <EmptyState
          title="Wrapped locked"
          copy={`This playback report can only be opened once every 30 days. ${formatUnlockMessage(locked)}`}
        />
      ) : !data ? (
        <LoadingState />
      ) : (
        <>
          <View style={styles.hero}>
            <View style={styles.heroCopy}>
              <Text style={styles.kicker}>{data.clientIp ? `IP ${data.clientIp}` : "This device"}</Text>
              <Text style={styles.title}>Your playback pulse</Text>
              <Text style={styles.period}>{period.label} / current IP only / {activeDays ? `${activeDays} active days` : "No active days yet"}</Text>
            </View>
            <View style={styles.metrics}>
              <Metric label="Play time" value={fmtTime(totalPlayTime)} />
              <Metric label="Plays" value={formatNumber(totalPlays)} />
              <Metric label="Density" value={`${listeningDensity}%`} />
              <Metric label="Streak" value={`${currentStreak}d`} />
            </View>
          </View>

          {isEmpty ? (
            <EmptyState
              title="No playback activity yet"
              copy="Play audio or video files from this IP and this page will build a playback report from those sessions."
            />
          ) : (
            <>
              <View style={[styles.panel, styles.storyPanel]}>
                <Text style={styles.storyLabel}>Most played</Text>
                <Text style={styles.storyTitle} numberOfLines={2}>{leadMedia?.title || "No top media yet"}</Text>
                <Text style={styles.storyMeta}>
                  {leadMedia
                    ? `${formatNumber(leadMedia.playCount || 0)} plays / ${fmtTime(leadMedia.totalTime || 0)} tracked`
                    : "Keep listening to build a ranked history."}
                </Text>
                <View style={styles.summaryList}>
                  <SummaryItem label="Daily average" value={fmtTime(Math.floor(totalPlayTime / 30))} />
                  <SummaryItem label="Best weekday" value={busiestWeekday.label} />
                  <SummaryItem label="Peak day" value={busiestDay?.playTime ? formatLongDate(busiestDay.date) : "None"} />
                </View>
              </View>

              <View style={styles.panel}>
                <SectionHeading
                  title="Playback rhythm"
                  detail={`${formatNumber(totalPlays)} events / peak ${busiestDay?.playTime ? `${formatLongDate(busiestDay.date)} at ${fmtTime(busiestDay.playTime)}` : "None yet"}`}
                  value={`${fmtTime(activeDays ? Math.floor(totalPlayTime / activeDays) : 0)} active-day avg`}
                />
                <DailyPulse timeline={timeline} maxDayTime={maxDayTime} />
                <ActivityHeatmap timeline={timeline} maxDayTime={maxDayTime} />
              </View>

              <View style={styles.panel}>
                <SectionHeading title="Activity feed" detail="Recent playback days" />
                <ActivityFeed days={activityDays} maxDayTime={maxDayTime} />
              </View>

              <View style={styles.panel}>
                <SectionHeading title="Top media" detail="Ranked by tracked play time" />
                <TopMediaList media={topMedia} maxMediaTime={maxMediaTime} />
              </View>

              <View style={styles.panel}>
                <SectionHeading title="Summary" detail="Thirty-day profile" />
                <View style={styles.summaryList}>
                  <SummaryItem label="Active-day average" value={fmtTime(activeDays ? Math.floor(totalPlayTime / activeDays) : 0)} />
                  <SummaryItem label="Peak play time" value={fmtTime(busiestDay?.playTime || 0)} />
                  <SummaryItem label="Active days" value={`${activeDays}/30`} />
                  <SummaryItem label="Best weekday time" value={fmtTime(busiestWeekday.playTime)} />
                </View>
              </View>
            </>
          )}
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
    gap: spacing.lg,
  },
  hero: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
    ...shadow.soft,
  },
  heroCopy: {
    gap: spacing.xs,
  },
  kicker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 34,
    lineHeight: 37,
    fontWeight: "900",
  },
  period: {
    color: colors.muted,
    fontWeight: "800",
    lineHeight: 20,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metric: {
    width: "48%",
    minHeight: 78,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.cardSoft,
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
    fontSize: 22,
    fontWeight: "900",
  },
  panel: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
  },
  storyPanel: {
    backgroundColor: "#1f2130",
  },
  storyLabel: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    overflow: "hidden",
    backgroundColor: "rgba(109,141,255,0.18)",
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  storyTitle: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 31,
    fontWeight: "900",
  },
  storyMeta: {
    color: colors.muted,
    lineHeight: 21,
    fontWeight: "800",
  },
  sectionHeading: {
    gap: spacing.md,
  },
  sectionCopy: {
    gap: spacing.xs,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  sectionDetail: {
    color: colors.muted,
    lineHeight: 20,
    fontWeight: "700",
  },
  sectionValue: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    overflow: "hidden",
    backgroundColor: colors.cardSoft,
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  pulse: {
    height: 110,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  pulseDay: {
    flex: 1,
    height: "100%",
    justifyContent: "flex-end",
  },
  pulseBar: {
    minHeight: 2,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: colors.primary,
  },
  heatmapShell: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  heatmapRows: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  weekdayColumn: {
    justifyContent: "space-between",
    paddingVertical: 1,
  },
  weekday: {
    height: 16,
    color: colors.subtle,
    fontSize: 9,
    fontWeight: "900",
  },
  heatmapGrid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  heatmapCell: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
  heatmapEmpty: {
    opacity: 0,
  },
  heatmapLevel0: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  heatmapLevel1: {
    backgroundColor: "rgba(109,141,255,0.25)",
  },
  heatmapLevel2: {
    backgroundColor: "rgba(109,141,255,0.45)",
  },
  heatmapLevel3: {
    backgroundColor: "rgba(109,141,255,0.68)",
  },
  heatmapLevel4: {
    backgroundColor: colors.primary,
  },
  heatmapLegend: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  legendText: {
    color: colors.subtle,
    fontSize: 11,
    fontWeight: "800",
  },
  legendCell: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  feedList: {
    gap: spacing.sm,
  },
  feedRow: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  feedDate: {
    width: 46,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: colors.cardSoft,
  },
  feedDay: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  feedNumber: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  feedCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  feedTitle: {
    color: colors.text,
    fontWeight: "900",
  },
  feedMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  progressTrack: {
    height: 5,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.11)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  mediaList: {
    gap: spacing.sm,
  },
  mediaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
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
  mediaCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  mediaTitle: {
    color: colors.text,
    fontWeight: "900",
  },
  mediaMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  summaryList: {
    gap: spacing.sm,
  },
  summaryItem: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.cardSoft,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  summaryValue: {
    marginTop: spacing.xs,
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  emptyState: {
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xxl,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
  },
  emptyMark: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "rgba(109,141,255,0.22)",
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyCopy: {
    color: colors.muted,
    lineHeight: 21,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyNote: {
    color: colors.muted,
    lineHeight: 20,
    fontWeight: "700",
  },
  warning: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.warningBg,
  },
  warningTitle: {
    color: colors.warningText,
    fontSize: 20,
    fontWeight: "900",
  },
  warningCopy: {
    color: colors.warningText,
    fontWeight: "800",
  },
  skeletonHero: {
    height: 260,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
  },
  skeletonGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  skeletonMetric: {
    width: "48%",
    height: 86,
    borderRadius: radii.md,
    backgroundColor: colors.card,
  },
  skeletonPanel: {
    height: 220,
    borderRadius: radii.xl,
    backgroundColor: colors.card,
  },
});
