const DAY_MS = 86400000;

export const WRAPPED_STORY_EXPORT = {
  cssWidth: 432,
  cssHeight: 768,
  width: 1080,
  height: 1920,
  pixelRatio: 2.5,
};

export function getWrappedSlideFilename(slide, index) {
  const number = String(index + 1).padStart(2, "0");
  const id = typeof slide?.id === "string" && slide.id ? slide.id : "slide";
  return `dogmedia-recap-${number}-${id}.png`;
}

export async function collectWrappedSlideExports(slides, render, onProgress = () => {}) {
  const exports = [];
  for (const [index, slide] of slides.entries()) {
    onProgress(index + 1, slides.length);
    const blob = await render(slide, index);
    exports.push({ blob, filename: getWrappedSlideFilename(slide, index) });
  }
  return exports;
}

export function getWrappedMediaTitle(media) {
  const title = typeof media?.title === "string" ? media.title.trim() : "";
  return title || (media?.mediaId ? `Media #${media.mediaId}` : "Untitled media");
}

export function getWrappedThumbnailUrl(media) {
  const mediaId = Number(media?.mediaId);
  return Number.isFinite(mediaId) && mediaId > 0 ? `/api/media/${mediaId}/thumbnail` : null;
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
    const key = [year, String(month + 1).padStart(2, "0"), String(dayOfMonth).padStart(2, "0")].join("-");
    const day = byDate.get(key);
    return {
      date: key,
      dateObject: date,
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

export function buildWaveformPoints(timeline, width = 100, height = 40) {
  if (!Array.isArray(timeline) || timeline.length === 0) return "";
  const max = Math.max(...timeline.map((day) => Number(day.playTime || 0)), 1);
  const step = timeline.length > 1 ? width / (timeline.length - 1) : 0;
  return timeline.map((day, index) => {
    const x = Number((index * step).toFixed(2));
    const ratio = Number(day.playTime || 0) / max;
    const y = Number((height - Math.max(ratio * height, day.playTime ? 3 : 0)).toFixed(2));
    return `${x},${y}`;
  }).join(" ");
}

export function buildWrappedSlides(data, timeline) {
  const topMedia = Array.isArray(data?.topMedia) ? data.topMedia : [];
  const lead = topMedia[0] || null;
  const rhythm = data?.rhythm || {};
  const persona = data?.persona || {
    key: "steady-signal",
    title: "Steady Signal",
    description: "Your playback rhythm is still taking shape.",
    palette: { accent: "#FF5A5F", secondary: "#2DC7C9" },
  };

  return [
    { id: "opening", lead, title: getWrappedMediaTitle(lead) },
    { id: "time", totalPlayTime: Number(data?.totalPlayTime || 0), waveform: buildWaveformPoints(timeline) },
    { id: "top-media", items: topMedia },
    { id: "rhythm", rhythm, categories: data?.topCategories || [] },
    { id: "persona", persona },
    { id: "share", lead, persona, totalPlayTime: Number(data?.totalPlayTime || 0) },
  ];
}
