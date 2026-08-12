import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, mediaThumbnailUrl } from "../api";
import { alpha, spacing, useTheme } from "../theme";
import {
  buildWrappedSlides,
  buildWrappedTimeline,
  getWrappedMediaTitle,
  getWrappedCopy,
  getWrappedStoryCardSize,
  isWrappedEmpty,
} from "../utils/wrapped-story";

const DAY_MS = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DISPLAY_FONT = Platform.select({ ios: "Arial", android: "sans-serif-condensed", default: "sans-serif" });
const MONO_FONT = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

function useWrappedTheme() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return { colors, styles };
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateUtc(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatLongDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });
}

function formatUnlockMessage(locked) {
  const nextOpenDate = formatLongDate(locked?.nextOpenAt);
  if (!nextOpenDate) return "Check back later.";
  const days = Math.max(Math.ceil(((locked?.retryAfterSeconds || 0) * 1000) / DAY_MS), 0);
  if (!days) return `Come back ${nextOpenDate}.`;
  return `Come back ${nextOpenDate}, in about ${days === 1 ? "1 day" : `${days} days`}.`;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function fmtTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!value) return "0m";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${value}s`;
}

function formatHour(hour) {
  if (!Number.isInteger(hour)) return "No peak yet";
  return new Date(Date.UTC(2026, 0, 1, hour)).toLocaleTimeString(undefined, {
    hour: "numeric",
    timeZone: "UTC",
  });
}

function weekdayLabel(dayIndex) {
  return Number.isInteger(dayIndex) ? WEEKDAYS[dayIndex] : "Still forming";
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
  timeline.forEach((day) => cells.push({ ...day, level: getActivityLevel(day.playTime, maxDayTime) }));
  while (cells.length % 7 !== 0) cells.push({ empty: true, level: 0 });
  return cells;
}

function getBusiestWeekday(timeline) {
  const totals = WEEKDAYS.map((label, dayIndex) => ({ dayIndex, label, playTime: 0, plays: 0 }));
  timeline.forEach((day) => {
    const index = day.dateObject?.getDay?.() || 0;
    totals[index].playTime += day.playTime || 0;
    totals[index].plays += day.plays || 0;
  });
  return totals.sort((a, b) => b.playTime - a.playTime || b.plays - a.plays)[0];
}

function Header({ onClose, periodLabel, setView, showSwitch, view }) {
  const insets = useSafeAreaInsets();
  const { colors, styles } = useWrappedTheme();
  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.headerControls}>
        <Pressable
          accessibilityLabel="Close Wrapped"
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        >
          <Ionicons color={colors.text} name="close" size={22} />
        </Pressable>
        {showSwitch && (
          <View accessibilityRole="tablist" style={styles.viewSwitch}>
            {[
              ["story", "Story"],
              ["summary", "Summary"],
            ].map(([value, label]) => {
              const selected = view === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setView(value)}
                  style={({ pressed }) => [styles.viewSwitchButton, selected && styles.viewSwitchButtonActive, pressed && styles.pressed]}
                >
                  <Text style={[styles.viewSwitchText, selected && styles.viewSwitchTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
      <Text style={styles.headerPeriod} numberOfLines={2}>{periodLabel}</Text>
    </View>
  );
}

function Artwork({ media, style, fallbackStyle, fallbackTextStyle }) {
  const [failed, setFailed] = useState(false);
  const mediaId = Number(media?.mediaId);
  useEffect(() => setFailed(false), [mediaId]);
  if (!Number.isFinite(mediaId) || mediaId <= 0 || failed) {
    return (
      <View style={[style, fallbackStyle]}>
        <Text style={fallbackTextStyle}>{getWrappedMediaTitle(media).slice(0, 1)}</Text>
      </View>
    );
  }
  return <Image source={{ uri: mediaThumbnailUrl(mediaId) }} resizeMode="cover" style={style} onError={() => setFailed(true)} />;
}

function StoryProgress({ current, dark, total }) {
  const { styles } = useWrappedTheme();
  return (
    <View accessibilityLabel={`Slide ${current + 1} of ${total}`} style={styles.storyProgress}>
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={[
            styles.storyProgressTrack,
            dark && styles.storyProgressTrackDark,
            index === current && (dark ? styles.storyProgressActiveDark : styles.storyProgressActive),
          ]}
        />
      ))}
    </View>
  );
}

function StoryStat({ label, value, styles }) {
  return (
    <View style={styles.storyStat}>
      <Text style={styles.storyStatLabel}>{label}</Text>
      <Text style={styles.storyStatValue} numberOfLines={2} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function Ribbon({ accessibilityLabel, bars, styles }) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.ribbon}>
      {bars.map((height, index) => (
        <View key={index} style={[styles.ribbonBar, { height: `${height * 100}%` }]} />
      ))}
    </View>
  );
}

function MediaTile({ lead = false, media, styles }) {
  return (
    <View style={[styles.mediaTile, lead && styles.mediaTileLead]}>
      <Artwork
        media={media}
        style={styles.mediaTileArtwork}
        fallbackStyle={styles.storyArtworkFallback}
        fallbackTextStyle={styles.storyArtworkFallbackText}
      />
      <Text style={styles.mediaTileRank}>{media?.rank || "-"}</Text>
      <View style={styles.mediaTileTitleShade}>
        <Text style={styles.mediaTileTitle} numberOfLines={1}>{getWrappedMediaTitle(media)}</Text>
      </View>
    </View>
  );
}

function StorySlide({ cardHeight, cardWidth, current, data, slide, total, wrappedCopy }) {
  const { styles } = useWrappedTheme();
  const scale = Math.min(cardWidth / 430, 1);
  const lead = data.topMedia?.[0] || slide.lead;
  const persona = data.persona || slide.persona || {};
  const totals = data.totals || {};
  const rhythm = data.rhythm || {};
  const darkProgress = ["time", "top-media", "rhythm", "persona"].includes(slide.id);
  const cardStyle = [styles.storyCard, { width: cardWidth, height: cardHeight }];

  let content;
  if (slide.id === "opening") {
    content = (
      <View style={[cardStyle, styles.openingSlide]}>
        <Artwork media={lead} style={StyleSheet.absoluteFillObject} fallbackStyle={styles.storyArtworkFallback} fallbackTextStyle={styles.openingFallbackText} />
        <View style={styles.openingShade} />
        <View style={[styles.openingCopy, { padding: 26 * scale }]}>
          <Text style={styles.lightKicker}>DogMedia / {wrappedCopy.recapLabel}</Text>
          <Text style={[styles.openingTitle, { fontSize: 54 * scale, lineHeight: 50 * scale }]}>{wrappedCopy.replayTitle}</Text>
          <Text style={styles.openingText}>{getWrappedMediaTitle(lead)} set the tone.</Text>
        </View>
      </View>
    );
  } else if (slide.id === "time") {
    content = (
      <View style={[cardStyle, styles.timeSlide, { padding: 26 * scale }]}>
        <Text style={styles.darkKicker}>Time in motion</Text>
        <Text style={[styles.bigNumber, { fontSize: 70 * scale, lineHeight: 64 * scale }]} numberOfLines={2} adjustsFontSizeToFit>{fmtTime(data.totalPlayTime)}</Text>
        <Text style={styles.darkLede}>tracked across {formatNumber(data.totalPlays)} starts</Text>
        <Ribbon accessibilityLabel={wrappedCopy.activityLabel} bars={slide.bars || []} styles={styles} />
        <View style={styles.storyStatsRow}>
          <StoryStat label="Active days" value={formatNumber(totals.activeDays)} styles={styles} />
          <StoryStat label="Media explored" value={formatNumber(totals.distinctMedia)} styles={styles} />
          <StoryStat label="Average session" value={fmtTime(totals.averageSession)} styles={styles} />
        </View>
      </View>
    );
  } else if (slide.id === "top-media") {
    const items = (data.topMedia || []).slice(0, 5);
    content = (
      <View style={[cardStyle, styles.topSlide, { padding: 24 * scale }]}>
        <Text style={styles.darkKicker}>Your rotation</Text>
        <Text style={[styles.storyHeadline, { fontSize: 43 * scale, lineHeight: 41 * scale }]}>Five titles stayed close</Text>
        <View style={styles.contactSheet}>
          {items[0] && <MediaTile lead media={items[0]} styles={styles} />}
          {[items.slice(1, 3), items.slice(3, 5)].map((row, rowIndex) => row.length > 0 && (
            <View key={rowIndex} style={styles.contactRow}>
              {row.map((media) => <MediaTile key={media.mediaId || media.rank} media={media} styles={styles} />)}
            </View>
          ))}
        </View>
      </View>
    );
  } else if (slide.id === "rhythm") {
    content = (
      <View style={[cardStyle, styles.rhythmSlide, { padding: 26 * scale }]}>
        <Text style={styles.darkKicker}>Your listening clock</Text>
        <Text style={[styles.clockValue, { fontSize: 68 * scale, lineHeight: 64 * scale }]} adjustsFontSizeToFit numberOfLines={2}>{formatHour(rhythm.peakHour)}</Text>
        <Text style={styles.darkLede}>was your strongest hour</Text>
        <View style={styles.rhythmGrid}>
          <RhythmCell label="Best weekday" value={weekdayLabel(rhythm.busiestWeekday?.dayIndex)} styles={styles} />
          <RhythmCell label="Longest streak" value={`${rhythm.longestStreak || 0} days`} styles={styles} />
          <RhythmCell label="After dark" value={`${Math.round((rhythm.nightShare || 0) * 100)}%`} styles={styles} />
          <RhythmCell label="Top folder" value={data.topCategories?.[0]?.name || "Still forming"} styles={styles} />
        </View>
      </View>
    );
  } else if (slide.id === "persona") {
    content = (
      <View style={[cardStyle, styles.personaSlide, { padding: 26 * scale, backgroundColor: persona.palette?.accent || colors.primary }]}>
        <Text style={styles.darkKicker}>Your playback character</Text>
        <View style={[styles.personaMark, { width: 142 * scale, height: 142 * scale, borderRadius: 71 * scale }]}>
          <Text style={[styles.personaInitial, { fontSize: 76 * scale }]}>{persona.title?.slice(0, 1) || "S"}</Text>
        </View>
        <Text style={[styles.personaTitle, { fontSize: 54 * scale, lineHeight: 49 * scale }]}>{persona.title || "Steady Signal"}</Text>
        <Text style={styles.personaCopy}>{persona.description || "Your playback rhythm is still taking shape."}</Text>
        <View style={styles.personaRule} />
        <Text style={styles.personaFoot}>{formatNumber(totals.distinctMedia)} titles / {formatNumber(totals.activeDays)} active days</Text>
      </View>
    );
  } else {
    content = (
      <View style={[cardStyle, styles.finalSlide, { padding: 26 * scale }]}>
        <View style={styles.finalArtworkFrame}>
          <Artwork media={lead} style={styles.finalArtwork} fallbackStyle={styles.storyArtworkFallback} fallbackTextStyle={styles.storyArtworkFallbackText} />
        </View>
        <Text style={styles.lightKicker}>DogMedia / {wrappedCopy.recapLabel}</Text>
        <Text style={[styles.finalTitle, { fontSize: 48 * scale, lineHeight: 44 * scale, color: persona.palette?.accent || colors.primary }]}>{persona.title || "Steady Signal"}</Text>
        <View style={styles.finalStats}>
          <FinalStat label="Play time" value={fmtTime(data.totalPlayTime)} color={persona.palette?.secondary} styles={styles} />
          <FinalStat label="Plays" value={formatNumber(data.totalPlays)} color={persona.palette?.secondary} styles={styles} />
        </View>
        <Text style={styles.finalTop} numberOfLines={2}>Top play: {getWrappedMediaTitle(lead)}</Text>
      </View>
    );
  }

  return (
    <View style={{ width: cardWidth, height: cardHeight }}>
      {content}
      <StoryProgress current={current} dark={darkProgress} total={total} />
      <Text style={[styles.storyCount, darkProgress && styles.storyCountDark]}>{String(current + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</Text>
    </View>
  );
}

function RhythmCell({ label, styles, value }) {
  return (
    <View style={styles.rhythmCell}>
      <Text style={styles.rhythmLabel}>{label}</Text>
      <Text style={styles.rhythmValue} numberOfLines={2} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function FinalStat({ color, label, styles, value }) {
  const { colors } = useWrappedTheme();
  return (
    <View style={[styles.finalStat, { borderTopColor: color || colors.primary }]}>
      <Text style={styles.finalStatValue}>{value}</Text>
      <Text style={styles.finalStatLabel}>{label}</Text>
    </View>
  );
}

function storyChapter(id) {
  return ({
    opening: "Opening",
    time: "Time in motion",
    "top-media": "Your rotation",
    rhythm: "Listening clock",
    persona: "Playback character",
    final: "Final recap",
  })[id] || "Recap";
}

function StoryViewer({ data, slides, wrappedCopy }) {
  const { colors, styles } = useWrappedTheme();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);
  const [index, setIndex] = useState(0);
  const { height: cardHeight, width: cardWidth } = getWrappedStoryCardSize(windowWidth, windowHeight);

  const goTo = useCallback((nextIndex) => {
    const bounded = Math.max(0, Math.min(nextIndex, slides.length - 1));
    listRef.current?.scrollToOffset({ animated: true, offset: bounded * windowWidth });
    setIndex(bounded);
  }, [slides.length, windowWidth]);

  useEffect(() => {
    listRef.current?.scrollToOffset({ animated: false, offset: index * windowWidth });
  }, [index, windowWidth]);

  return (
    <View style={styles.storyViewer}>
      <FlatList
        ref={listRef}
        data={slides}
        horizontal
        pagingEnabled
        bounces={false}
        decelerationRate="fast"
        keyExtractor={(slide) => slide.id}
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_items, itemIndex) => ({ length: windowWidth, offset: windowWidth * itemIndex, index: itemIndex })}
        onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / windowWidth))}
        renderItem={({ item, index: slideIndex }) => (
          <View style={[styles.storyPage, { width: windowWidth }]}>
            <View style={[styles.storyFrame, { width: cardWidth, height: cardHeight }]}>
              <StorySlide
                cardHeight={cardHeight}
                cardWidth={cardWidth}
                current={slideIndex}
                data={data}
                slide={item}
                total={slides.length}
                wrappedCopy={wrappedCopy}
              />
            </View>
          </View>
        )}
      />
      <View style={[styles.storyNavigation, { paddingBottom: Math.max(insets.bottom, 6) }]}>
        <Pressable
          accessibilityLabel="Previous slide"
          disabled={index === 0}
          onPress={() => goTo(index - 1)}
          style={({ pressed }) => [styles.storyNavButton, index === 0 && styles.storyNavButtonDisabled, pressed && styles.pressed]}
        >
          <Ionicons color={colors.text} name="chevron-back" size={20} />
        </Pressable>
        <Text style={styles.storyChapter} numberOfLines={1}>{storyChapter(slides[index]?.id)}</Text>
        <Pressable
          accessibilityLabel="Next slide"
          disabled={index === slides.length - 1}
          onPress={() => goTo(index + 1)}
          style={({ pressed }) => [styles.storyNavButton, index === slides.length - 1 && styles.storyNavButtonDisabled, pressed && styles.pressed]}
        >
          <Ionicons color={colors.text} name="chevron-forward" size={20} />
        </Pressable>
      </View>
    </View>
  );
}

function Metric({ label, value }) {
  const { styles } = useWrappedTheme();
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function SummaryItem({ label, value }) {
  const { styles } = useWrappedTheme();
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function SectionHeading({ detail, title, value }) {
  const { styles } = useWrappedTheme();
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

function DailyPulse({ maxDayTime, timeline }) {
  const { styles } = useWrappedTheme();
  return (
    <View accessibilityLabel="Daily playback time" style={styles.pulse}>
      {timeline.map((day) => {
        const pct = Math.max((day.playTime / maxDayTime) * 100, day.playTime ? 12 : 0);
        return <View key={day.date} style={styles.pulseDay}><View style={[styles.pulseBar, { height: `${pct}%` }]} /></View>;
      })}
    </View>
  );
}

function ActivityHeatmap({ maxDayTime, timeline }) {
  const { styles } = useWrappedTheme();
  const cells = buildHeatmapCells(timeline, maxDayTime);
  return (
    <View style={styles.heatmapShell}>
      <View style={styles.heatmapRows}>
        <View style={styles.weekdayColumn}>{WEEKDAYS.map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}</View>
        <View style={styles.heatmapGrid}>
          {cells.map((cell, index) => (
            <View key={cell.date || `empty-${index}`} style={[styles.heatmapCell, styles[`heatmapLevel${cell.level || 0}`], cell.empty && styles.heatmapEmpty]} />
          ))}
        </View>
      </View>
    </View>
  );
}

function ActivityFeed({ days, maxDayTime }) {
  const { styles } = useWrappedTheme();
  if (!days.length) return <Text style={styles.emptyNote}>Activity will appear after playback events are recorded.</Text>;
  return (
    <View style={styles.feedList}>
      {days.slice(0, 8).map((day) => {
        const pct = Math.max((day.playTime / maxDayTime) * 100, 8);
        return (
          <View key={day.date} style={styles.feedRow}>
            <View style={styles.feedDate}>
              <Text style={styles.feedDay}>{day.dayName}</Text>
              <Text style={styles.feedNumber}>{new Date(`${day.date}T12:00:00`).getDate()}</Text>
            </View>
            <View style={styles.feedCopy}>
              <Text style={styles.feedTitle}>{formatLongDate(`${day.date}T12:00:00`)}</Text>
              <Text style={styles.feedMeta}>{fmtTime(day.playTime)} / {formatNumber(day.plays)} plays</Text>
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function TopMediaList({ maxMediaTime, media }) {
  const { styles } = useWrappedTheme();
  return (
    <View style={styles.mediaList}>
      {media.map((item, index) => {
        const pct = Math.max(((item.totalTime || 0) / maxMediaTime) * 100, 3);
        return (
          <View key={`${item.mediaId || "media"}-${index}`} style={styles.mediaRow}>
            <Text style={styles.rank}>{index + 1}</Text>
            <View style={styles.mediaCopy}>
              <Text style={styles.mediaTitle} numberOfLines={2}>{getWrappedMediaTitle(item)}</Text>
              <Text style={styles.mediaMeta}>{formatNumber(item.playCount)} plays / {fmtTime(item.totalTime)}</Text>
              <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function CategoryList({ categories }) {
  const { styles } = useWrappedTheme();
  if (!categories.length) return <Text style={styles.emptyNote}>Folder activity is still forming.</Text>;
  return (
    <View style={styles.categoryList}>
      {categories.map((category, index) => (
        <View key={category.categoryId ?? category.name} style={styles.categoryRow}>
          <Text style={styles.categoryRank}>{category.rank || index + 1}</Text>
          <View style={styles.categoryCopy}>
            <Text style={styles.categoryTitle}>{category.name}</Text>
            <Text style={styles.categoryMeta}>{fmtTime(category.totalTime)} / {formatNumber(category.playCount)} plays</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function SummaryDashboard({ data, insets, periodLabel, timeline, wrappedCopy }) {
  const { styles } = useWrappedTheme();
  const topMedia = data.topMedia || [];
  const totalPlayTime = data.totalPlayTime || 0;
  const totalPlays = data.totalPlays || 0;
  const activeDays = data.totals?.activeDays ?? timeline.filter((day) => day.playTime || day.plays).length;
  const maxDayTime = Math.max(...timeline.map((day) => day.playTime), 1);
  const maxMediaTime = Math.max(...topMedia.map((media) => media.totalTime || 0), 1);
  const busiestDay = data.rhythm?.busiestDay || [...timeline].sort((a, b) => b.playTime - a.playTime)[0];
  const localWeekday = getBusiestWeekday(timeline);
  const busiestWeekday = data.rhythm?.busiestWeekday || localWeekday;
  const activityDays = timeline.filter((day) => day.playTime || day.plays).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <ScrollView style={styles.summaryScreen} contentContainerStyle={[styles.summaryContent, { paddingBottom: 32 + insets.bottom }]} showsVerticalScrollIndicator={false}>
      <View style={styles.summaryHero}>
        <Text style={styles.summaryEyebrow}>This device / {periodLabel}</Text>
        <Text style={styles.summaryHeroTitle}>Your playback pulse</Text>
        <Text style={styles.summaryHeroSubtitle}>{wrappedCopy.storyDescription}</Text>
        <View style={styles.metrics}>
          <Metric label="Play time" value={fmtTime(totalPlayTime)} />
          <Metric label="Plays" value={formatNumber(totalPlays)} />
          <Metric label="Active days" value={formatNumber(activeDays)} />
          <Metric label="Streak" value={`${data.rhythm?.longestStreak || 0}d`} />
        </View>
      </View>

      <View style={[styles.panel, styles.summaryLeadPanel]}>
        <Text style={styles.summaryLeadLabel}>Most played</Text>
        <Text style={styles.summaryLeadTitle}>{getWrappedMediaTitle(topMedia[0])}</Text>
        <Text style={styles.summaryLeadMeta}>{topMedia[0] ? `${formatNumber(topMedia[0].playCount)} plays / ${fmtTime(topMedia[0].totalTime)} tracked` : "Keep listening to build a ranked history."}</Text>
        <View style={styles.summaryList}>
          <SummaryItem label="Persona" value={data.persona?.title || "Steady Signal"} />
          <SummaryItem label="Peak hour" value={formatHour(data.rhythm?.peakHour)} />
          <SummaryItem label="Best weekday" value={weekdayLabel(busiestWeekday?.dayIndex)} />
        </View>
      </View>

      <View style={styles.panel}>
        <SectionHeading title="Playback rhythm" detail={wrappedCopy.rhythmDetail} value={`${fmtTime(data.totals?.averageSession)} average`} />
        <DailyPulse timeline={timeline} maxDayTime={maxDayTime} />
        <ActivityHeatmap timeline={timeline} maxDayTime={maxDayTime} />
      </View>

      <View style={styles.panel}>
        <SectionHeading title="Top folders" detail="Ranked by tracked time" />
        <CategoryList categories={data.topCategories || []} />
      </View>

      <View style={styles.panel}>
        <SectionHeading title="Top media" detail="Ranked by tracked time" />
        <TopMediaList media={topMedia} maxMediaTime={maxMediaTime} />
      </View>

      <View style={styles.panel}>
        <SectionHeading title="Activity feed" detail="Recent playback days" />
        <ActivityFeed days={activityDays} maxDayTime={maxDayTime} />
      </View>

      <View style={styles.panel}>
        <SectionHeading title="Milestones" detail="Moments from this recap" />
        <View style={styles.summaryList}>
          <SummaryItem label="First play" value={data.milestones?.firstPlayAt ? formatLongDate(data.milestones.firstPlayAt) : "None"} />
          <SummaryItem label="Biggest day" value={busiestDay?.date ? formatLongDate(`${busiestDay.date}T12:00:00`) : "None"} />
          <SummaryItem label="Media explored" value={formatNumber(data.totals?.distinctMedia)} />
          <SummaryItem label="After dark" value={`${Math.round((data.rhythm?.nightShare || 0) * 100)}%`} />
        </View>
      </View>
    </ScrollView>
  );
}

function EmptyState({ copy, title }) {
  const { styles } = useWrappedTheme();
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyMark} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyCopy}>{copy}</Text>
    </View>
  );
}

function StateScreen({ children }) {
  const { styles } = useWrappedTheme();
  const insets = useSafeAreaInsets();
  return <ScrollView contentContainerStyle={[styles.stateContent, { paddingBottom: 32 + insets.bottom }]}>{children}</ScrollView>;
}

export function WrappedScreen({ navigation, onAccessChanged }) {
  const { colors, styles } = useWrappedTheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [locked, setLocked] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("story");

  const period = useMemo(() => {
    const to = new Date();
    const from = new Date(Date.now() - 29 * DAY_MS);
    return {
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      label: `${formatDate(from)} - ${formatDate(to)}`,
    };
  }, []);

  const load = useCallback(() => {
    setData(null);
    setError("");
    setLocked(null);
    const timezoneOffset = new Date().getTimezoneOffset();
    return api(`/api/wrapped/current?from=${period.fromIso}&to=${period.toIso}&timezoneOffset=${timezoneOffset}`)
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
      .catch(() => setError("Could not load your recap. Check the server connection and try again."));
  }, [onAccessChanged, period.fromIso, period.toIso]);

  useEffect(() => { load(); }, [load]);

  const timeline = useMemo(
    () => buildWrappedTimeline(data, data?.periodStart || period.fromIso),
    [data, period.fromIso]
  );
  const slides = useMemo(() => buildWrappedSlides(data, timeline), [data, timeline]);
  const wrappedCopy = useMemo(() => getWrappedCopy(data || locked), [data, locked]);
  const serverPeriodLabel = data?.periodStart && data?.periodEnd
    ? `${formatDateUtc(data.periodStart)} - ${formatDateUtc(data.periodEnd)}`
    : period.label;
  const empty = data ? isWrappedEmpty(data) : false;
  const showSwitch = Boolean(data && !empty);
  const headerPeriodLabel = `${serverPeriodLabel} · ${wrappedCopy.recapLabel}`;

  return (
    <View style={styles.screen}>
      <Header
        onClose={() => navigation.navigate("Home")}
        periodLabel={headerPeriodLabel}
        setView={setView}
        showSwitch={showSwitch}
        view={view}
      />
      {error ? (
        <StateScreen>
          <View style={styles.warning}>
            <Text style={styles.warningTitle}>Wrapped unavailable</Text>
            <Text style={styles.warningCopy}>{error}</Text>
          </View>
        </StateScreen>
      ) : locked ? (
        <StateScreen>
          <EmptyState title="Wrapped locked" copy={getLockedCopy(locked)} />
        </StateScreen>
      ) : !data ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Building your recap</Text>
        </View>
      ) : empty ? (
        <StateScreen>
          <EmptyState title="Your recap needs a first play" copy="Play audio or video from this device. Your next recap will turn those sessions into a playback story." />
        </StateScreen>
      ) : view === "story" ? (
        <StoryViewer data={data} slides={slides} wrappedCopy={wrappedCopy} />
      ) : (
        <SummaryDashboard data={data} insets={insets} periodLabel={serverPeriodLabel} timeline={timeline} wrappedCopy={wrappedCopy} />
      )}
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.72 },
  header: { minHeight: 76, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 14, paddingBottom: 10, backgroundColor: colors.bg },
  headerControls: { flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 10 },
  closeButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: alpha(colors.text, 0.18), borderRadius: 21, backgroundColor: alpha(colors.text, 0.08) },
  headerPeriod: { flex: 1, minWidth: 0, color: alpha(colors.text, 0.72), fontSize: 10, lineHeight: 14, fontWeight: "900", textAlign: "right" },
  viewSwitch: { width: 136, minHeight: 42, flexDirection: "row", padding: 3, borderWidth: 1, borderColor: alpha(colors.text, 0.18), borderRadius: 9, backgroundColor: alpha(colors.text, 0.08) },
  viewSwitchButton: { flex: 1, minHeight: 34, alignItems: "center", justifyContent: "center", borderRadius: 7 },
  viewSwitchButtonActive: { backgroundColor: colors.text },
  viewSwitchText: { color: alpha(colors.text, 0.72), fontSize: 11, fontWeight: "900" },
  viewSwitchTextActive: { color: colors.bg },
  storyViewer: { flex: 1, justifyContent: "center", paddingVertical: 4 },
  storyPage: { alignItems: "center", justifyContent: "center" },
  storyFrame: { borderRadius: 8, backgroundColor: colors.bg, shadowColor: colors.black, shadowOpacity: 0.34, shadowRadius: 28, shadowOffset: { width: 0, height: 16 }, elevation: 12 },
  storyCard: { position: "relative", overflow: "hidden", borderWidth: 1, borderColor: alpha(colors.text, 0.18), borderRadius: 8, backgroundColor: colors.bg },
  storyProgress: { position: "absolute", zIndex: 10, top: 13, right: 13, left: 13, height: 16, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 3, borderRadius: 4, backgroundColor: alpha(colors.text, 0.34) },
  storyProgressTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: alpha(colors.bg, 0.34) },
  storyProgressTrackDark: { backgroundColor: alpha(colors.text, 0.22) },
  storyProgressActive: { backgroundColor: colors.bg },
  storyProgressActiveDark: { backgroundColor: colors.text },
  storyCount: { position: "absolute", zIndex: 10, right: 16, bottom: 12, color: alpha(colors.bg, 0.7), fontFamily: MONO_FONT, fontSize: 9, fontWeight: "900" },
  storyCountDark: { color: alpha(colors.text, 0.62) },
  openingSlide: { justifyContent: "flex-end", backgroundColor: colors.bg },
  openingShade: { ...StyleSheet.absoluteFillObject, top: "38%", backgroundColor: alpha(colors.text, 0.86) },
  openingCopy: { zIndex: 2, paddingBottom: 56 },
  lightKicker: { color: colors.bg, fontFamily: MONO_FONT, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  openingTitle: { maxWidth: 350, marginTop: 12, color: colors.bg, fontFamily: DISPLAY_FONT, fontWeight: "900" },
  openingText: { maxWidth: 310, marginTop: 15, color: alpha(colors.bg, 0.76), fontSize: 13, lineHeight: 19, fontWeight: "700" },
  storyArtworkFallback: { alignItems: "center", justifyContent: "center", backgroundColor: alpha(colors.primary, 0.35) },
  storyArtworkFallbackText: { color: colors.text, fontFamily: DISPLAY_FONT, fontSize: 58, fontWeight: "900" },
  openingFallbackText: { color: colors.text, fontFamily: DISPLAY_FONT, fontSize: 110, fontWeight: "900" },
  timeSlide: { backgroundColor: alpha(colors.primary, 0.22) },
  darkKicker: { color: colors.text, fontFamily: MONO_FONT, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  bigNumber: { marginTop: "18%", color: colors.text, fontFamily: DISPLAY_FONT, fontWeight: "900" },
  darkLede: { marginTop: 8, color: colors.text, fontSize: 13, fontWeight: "800" },
  ribbon: { height: 112, flexDirection: "row", alignItems: "flex-end", gap: 2, marginTop: "auto", paddingTop: 12, borderBottomWidth: 1, borderBottomColor: alpha(colors.text, 0.28) },
  ribbonBar: { flex: 1, minHeight: 2, backgroundColor: colors.text, transform: [{ skewX: "-8deg" }] },
  storyStatsRow: { flexDirection: "row", marginTop: 18, marginBottom: 24, borderTopWidth: 1, borderTopColor: alpha(colors.text, 0.32) },
  storyStat: { flex: 1, minWidth: 0, paddingTop: 10, paddingRight: 5 },
  storyStatLabel: { minHeight: 27, color: colors.text, fontSize: 8, fontWeight: "900", textTransform: "uppercase" },
  storyStatValue: { marginTop: 4, color: colors.text, fontFamily: MONO_FONT, fontSize: 11, fontWeight: "900" },
  topSlide: { backgroundColor: alpha(colors.primary, 0.35) },
  storyHeadline: { maxWidth: 330, marginTop: 14, marginBottom: 16, color: colors.text, fontFamily: DISPLAY_FONT, fontWeight: "900" },
  contactSheet: { flex: 1, gap: 6 },
  contactRow: { flex: 1, flexDirection: "row", gap: 6 },
  mediaTile: { flex: 1, position: "relative", minWidth: 0, overflow: "hidden", borderWidth: 2, borderColor: colors.text, backgroundColor: colors.bg },
  mediaTileLead: { flex: 1.3 },
  mediaTileArtwork: { width: "100%", height: "100%" },
  mediaTileRank: { position: "absolute", top: 7, left: 7, minWidth: 24, height: 24, paddingHorizontal: 6, overflow: "hidden", backgroundColor: alpha(colors.primary, 0.22), color: colors.text, fontFamily: MONO_FONT, fontSize: 10, lineHeight: 24, fontWeight: "900", textAlign: "center" },
  mediaTileTitleShade: { position: "absolute", right: 0, bottom: 0, left: 0, paddingHorizontal: 8, paddingVertical: 7, backgroundColor: alpha(colors.text, 0.86) },
  mediaTileTitle: { color: colors.bg, fontSize: 9, fontWeight: "900" },
  rhythmSlide: { backgroundColor: colors.primary },
  clockValue: { maxWidth: "100%", marginTop: "22%", color: colors.text, fontFamily: DISPLAY_FONT, fontWeight: "900" },
  rhythmGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: "auto", marginBottom: 26, borderTopWidth: 1, borderLeftWidth: 1, borderColor: alpha(colors.text, 0.62) },
  rhythmCell: { width: "50%", minHeight: 92, justifyContent: "space-between", padding: 12, borderRightWidth: 1, borderBottomWidth: 1, borderColor: alpha(colors.text, 0.62) },
  rhythmLabel: { color: colors.text, fontSize: 8, fontWeight: "900", textTransform: "uppercase" },
  rhythmValue: { color: colors.text, fontSize: 15, lineHeight: 17, fontWeight: "900" },
  personaSlide: { backgroundColor: colors.primary },
  personaMark: { alignItems: "center", justifyContent: "center", marginTop: "14%", marginBottom: 20, borderWidth: 3, borderColor: colors.text },
  personaInitial: { color: colors.text, fontFamily: DISPLAY_FONT, fontWeight: "900" },
  personaTitle: { color: colors.text, fontFamily: DISPLAY_FONT, fontWeight: "900" },
  personaCopy: { maxWidth: 330, marginTop: 16, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  personaRule: { height: 2, marginTop: "auto", backgroundColor: colors.text },
  personaFoot: { marginTop: 11, marginBottom: 24, color: colors.text, fontFamily: MONO_FONT, fontSize: 9, fontWeight: "900" },
  finalSlide: { backgroundColor: colors.text },
  finalArtworkFrame: { width: "100%", aspectRatio: 1, overflow: "hidden", marginBottom: 18, borderWidth: 2, borderColor: colors.bg },
  finalArtwork: { width: "100%", height: "100%" },
  finalTitle: { marginTop: 11, fontFamily: DISPLAY_FONT, fontWeight: "900" },
  finalStats: { flexDirection: "row", gap: 10, marginTop: 22 },
  finalStat: { flex: 1, gap: 3, paddingTop: 8, borderTopWidth: 2 },
  finalStatValue: { color: colors.bg, fontFamily: MONO_FONT, fontSize: 16, fontWeight: "900" },
  finalStatLabel: { color: alpha(colors.bg, 0.62), fontSize: 8, fontWeight: "900", textTransform: "uppercase" },
  finalTop: { marginTop: 16, color: alpha(colors.bg, 0.62), fontSize: 9, lineHeight: 13, fontWeight: "900", textTransform: "uppercase" },
  storyNavigation: { width: "100%", maxWidth: 430, flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "center", gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 },
  storyNavButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: alpha(colors.text, 0.18), borderRadius: 22, backgroundColor: alpha(colors.text, 0.08) },
  storyNavButtonDisabled: { opacity: 0.28 },
  storyChapter: { flex: 1, height: 44, paddingHorizontal: 10, overflow: "hidden", borderWidth: 1, borderColor: alpha(colors.text, 0.14), borderRadius: 10, backgroundColor: alpha(colors.text, 0.06), color: alpha(colors.text, 0.72), fontFamily: MONO_FONT, fontSize: 9, lineHeight: 42, fontWeight: "900", textAlign: "center", textTransform: "uppercase" },
  summaryScreen: { flex: 1 },
  summaryContent: { gap: 14, padding: spacing.lg },
  summaryHero: { gap: 6, paddingVertical: 8 },
  summaryEyebrow: { color: colors.primary, fontFamily: MONO_FONT, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  summaryHeroTitle: { color: colors.text, fontFamily: DISPLAY_FONT, fontSize: 37, lineHeight: 39, fontWeight: "900" },
  summaryHeroSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, fontWeight: "700" },
  metrics: { flexDirection: "row", flexWrap: "wrap", marginTop: 14, borderTopWidth: 1, borderLeftWidth: 1, borderColor: colors.cardSoft },
  metric: { width: "50%", minHeight: 70, padding: 11, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.cardSoft },
  metricLabel: { color: colors.muted, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  metricValue: { marginTop: 7, color: colors.text, fontFamily: MONO_FONT, fontSize: 20, fontWeight: "900" },
  panel: { gap: 14, padding: 15, borderWidth: 1, borderColor: colors.cardSoft, borderRadius: 8, backgroundColor: colors.card },
  summaryLeadPanel: { backgroundColor: colors.surface },
  summaryLeadLabel: { color: colors.primary, fontFamily: MONO_FONT, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  summaryLeadTitle: { color: colors.text, fontFamily: DISPLAY_FONT, fontSize: 28, lineHeight: 30, fontWeight: "900" },
  summaryLeadMeta: { color: colors.muted, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  sectionHeading: { gap: 5 },
  sectionCopy: { gap: 3 },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: "900" },
  sectionDetail: { color: colors.muted, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  sectionValue: { alignSelf: "flex-start", color: colors.primary, fontFamily: MONO_FONT, fontSize: 10, fontWeight: "900" },
  pulse: { height: 96, flexDirection: "row", alignItems: "flex-end", gap: 2, paddingTop: 8, borderBottomWidth: 1, borderBottomColor: colors.cardSoft },
  pulseDay: { flex: 1, height: "100%", justifyContent: "flex-end" },
  pulseBar: { minHeight: 2, backgroundColor: colors.primary },
  heatmapShell: { paddingTop: 4 },
  heatmapRows: { flexDirection: "row", gap: 7 },
  weekdayColumn: { justifyContent: "space-between", paddingVertical: 1 },
  weekday: { height: 15, color: colors.subtle, fontSize: 8, fontWeight: "900" },
  heatmapGrid: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 4 },
  heatmapCell: { width: 15, height: 15, borderRadius: 3 },
  heatmapEmpty: { opacity: 0 },
  heatmapLevel0: { backgroundColor: colors.cardSoft },
  heatmapLevel1: { backgroundColor: alpha(colors.primary, 0.25) },
  heatmapLevel2: { backgroundColor: alpha(colors.primary, 0.45) },
  heatmapLevel3: { backgroundColor: alpha(colors.primary, 0.68) },
  heatmapLevel4: { backgroundColor: colors.primary },
  feedList: { gap: 8 },
  feedRow: { flexDirection: "row", gap: 11, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardSoft },
  feedDate: { width: 42, height: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.cardSoft, borderRadius: 6 },
  feedDay: { color: colors.muted, fontSize: 8, fontWeight: "900", textTransform: "uppercase" },
  feedNumber: { color: colors.text, fontFamily: MONO_FONT, fontSize: 16, fontWeight: "900" },
  feedCopy: { flex: 1, minWidth: 0, gap: 3 },
  feedTitle: { color: colors.text, fontSize: 12, fontWeight: "900" },
  feedMeta: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  progressTrack: { height: 4, overflow: "hidden", marginTop: 3, backgroundColor: colors.cardSoft },
  progressFill: { height: "100%", backgroundColor: colors.primary },
  mediaList: { gap: 4 },
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardSoft },
  rank: { width: 30, color: colors.primary, fontFamily: MONO_FONT, fontSize: 18, fontWeight: "900", textAlign: "center" },
  mediaCopy: { flex: 1, minWidth: 0, gap: 3 },
  mediaTitle: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: "900" },
  mediaMeta: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  categoryList: { gap: 4 },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardSoft },
  categoryRank: { width: 26, color: colors.primary, fontFamily: MONO_FONT, fontSize: 15, fontWeight: "900", textAlign: "center" },
  categoryCopy: { flex: 1, gap: 2 },
  categoryTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  categoryMeta: { color: colors.muted, fontSize: 10, fontWeight: "700" },
  summaryList: { gap: 0 },
  summaryItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.cardSoft },
  summaryLabel: { color: colors.muted, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  summaryValue: { marginTop: 3, color: colors.text, fontSize: 15, lineHeight: 19, fontWeight: "900" },
  emptyNote: { color: colors.muted, fontSize: 12, lineHeight: 18, fontWeight: "700" },
  stateContent: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  emptyState: { alignItems: "center", gap: 12, padding: 28, borderWidth: 1, borderColor: colors.cardSoft, borderRadius: 8, backgroundColor: colors.card },
  emptyMark: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary },
  emptyTitle: { color: colors.text, fontSize: 23, fontWeight: "900", textAlign: "center" },
  emptyCopy: { color: colors.muted, fontSize: 13, lineHeight: 20, fontWeight: "700", textAlign: "center" },
  warning: { gap: 8, padding: 16, borderWidth: 1, borderColor: colors.warningBorder, borderRadius: 8, backgroundColor: colors.warningBg },
  warningTitle: { color: colors.warningText, fontSize: 19, fontWeight: "900" },
  warningCopy: { color: colors.warningText, lineHeight: 19, fontWeight: "700" },
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
});

function getLockedCopy(locked) {
  if (locked?.wrappedKind === "annual" || locked?.period?.kind === "annual-year") {
    return `Annual Wrapped opens December 15. ${formatUnlockMessage(locked)}`;
  }
  return `This playback report can only be opened once every 30 days. ${formatUnlockMessage(locked)}`;
}
