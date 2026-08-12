const DAY_MS = 86400000;

export const WRAPPED_COLORS = {
  ink: "#111318",
  coral: "#FF5A5F",
  cyan: "#2DC7C9",
  yellow: "#FFD166",
  white: "#F5F7F4",
};

export function getWrappedStoryCardSize(windowWidth, windowHeight) {
  const availableWidth = Math.max(windowWidth - 76, 0);
  const availableHeight = Math.max(windowHeight - 190, 0);
  const height = Math.min(764, availableHeight, (availableWidth * 16) / 9);
  return { width: height * 9 / 16, height };
}

export function getWrappedMediaTitle(media) {
  const title = typeof media?.title === "string" ? media.title.trim() : "";
  return title || (media?.mediaId ? `Media #${media.mediaId}` : "Untitled media");
}

export function isWrappedEmpty(data) {
  return !data || (
    Number(data.totalPlayTime || 0) === 0
    && Number(data.totalPlays || 0) === 0
    && (!Array.isArray(data.topMedia) || data.topMedia.length === 0)
  );
}

export function buildWrappedTimeline(data, periodStart, days = 30) {
  const periodDays = getWrappedPeriodDays(data, days);
  const useUtcDates = getWrappedPeriodKind(data) === "annual";
  const byDate = new Map((data?.timeline || []).map((day) => [day.date, day]));
  const start = new Date(periodStart);
  return Array.from({ length: periodDays }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS);
    const year = useUtcDates ? date.getUTCFullYear() : date.getFullYear();
    const month = useUtcDates ? date.getUTCMonth() : date.getMonth();
    const dayOfMonth = useUtcDates ? date.getUTCDate() : date.getDate();
    const key = [
      year,
      String(month + 1).padStart(2, "0"),
      String(dayOfMonth).padStart(2, "0"),
    ].join("-");
    const day = byDate.get(key);
    return {
      date: key,
      dateObject: date,
      dayName: date.toLocaleDateString(undefined, { weekday: "short" }),
      playTime: Number(day?.playTime || 0),
      plays: Number(day?.plays || 0),
    };
  });
}

export function getWrappedPeriodKind(data) {
  return data?.wrappedKind === "annual" || data?.period?.kind === "annual-year" ? "annual" : "monthly";
}

export function getWrappedPeriodDays(data, fallback = 30) {
  const days = Number(data?.period?.days);
  if (Number.isFinite(days) && days > 0) return Math.floor(days);
  if (data?.periodStart && data?.periodEnd) {
    const start = new Date(data.periodStart);
    const end = new Date(data.periodEnd);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
      const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
      return Math.max(Math.floor((endDay - startDay) / DAY_MS) + 1, 1);
    }
  }
  return fallback;
}

export function getWrappedCopy(data) {
  const annual = getWrappedPeriodKind(data) === "annual";
  return {
    recapLabel: annual ? "1-year recap" : "30-day recap",
    replayTitle: annual ? "Your 1-year replay" : "Your 30-day replay",
    storyDescription: annual ? "A detailed view of the same 1-year story." : "A detailed view of the same 30-day story.",
    activityLabel: annual ? "One-year playback activity" : "Thirty-day playback activity",
    rhythmDetail: annual ? "A year of tracked sessions" : "Thirty days of tracked sessions",
  };
}

export function buildRibbonBars(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return [];
  const max = Math.max(...timeline.map((day) => Number(day.playTime || 0)), 1);
  return timeline.map((day) => {
    const playTime = Number(day.playTime || 0);
    return playTime ? Math.max(playTime / max, 0.08) : 0.02;
  });
}

export function buildWrappedSlides(data, timeline) {
  const topMedia = Array.isArray(data?.topMedia) ? data.topMedia : [];
  const lead = topMedia[0] || null;
  const persona = data?.persona || {
    key: "steady-signal",
    title: "Steady Signal",
    description: "Your playback rhythm is still taking shape.",
    palette: { accent: WRAPPED_COLORS.coral, secondary: WRAPPED_COLORS.cyan },
  };

  return [
    { id: "opening", lead },
    { id: "time", bars: buildRibbonBars(timeline) },
    { id: "top-media", items: topMedia },
    { id: "rhythm", rhythm: data?.rhythm || {}, categories: data?.topCategories || [] },
    { id: "persona", persona },
    { id: "final", lead, persona },
  ];
}
