const DAY_MS = 86400000;

export const WRAPPED_COLORS = {
  ink: "#111318",
  coral: "#FF5A5F",
  cyan: "#2DC7C9",
  yellow: "#FFD166",
  white: "#F5F7F4",
};

export function getWrappedStoryCardSize(windowWidth, windowHeight) {
  const height = Math.max(300, Math.min(764, windowHeight - 248, ((windowWidth - 28) * 16) / 9));
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
  const byDate = new Map((data?.timeline || []).map((day) => [day.date, day]));
  const start = new Date(periodStart);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS);
    const key = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
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
