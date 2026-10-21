const DAY_MS = 86400000;

export const WRAPPED_STORY_EXPORT = {
  cssWidth: 432,
  cssHeight: 768,
  width: 1080,
  height: 1920,
  pixelRatio: 2.5,
};

function rgb(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(channels) {
  return channels.reduce((sum, channel, index) => {
    const value = channel / 255;
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function contrast(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function blend(channels, target, amount) {
  return channels.map((channel) => Math.round(channel + (target - channel) * amount));
}

function readableShade(channels, against, target, minimumContrast) {
  for (let step = 0; step <= 20; step += 1) {
    const shade = blend(channels, target, step / 20);
    if (contrast(shade, against) >= minimumContrast) return shade;
  }
  return [target, target, target];
}

function hex(channels) {
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

const COLORED_SLIDES = ["time", "top-media", "rhythm", "devices", "persona"];

export function getWrappedSlidePaletteStyle(slideId, colors) {
  const palette = (Array.isArray(colors) ? colors : [])
    .slice(0, 5)
    .map((entry) => entry?.hex)
    .filter((color) => rgb(color));
  if (!palette.length) return {};

  const index = COLORED_SLIDES.indexOf(slideId);
  if (index >= 0) {
    const background = palette[index % palette.length];
    const channels = rgb(background);
    const foreground = contrast(channels, [0, 0, 0]) >= contrast(channels, [255, 255, 255])
      ? "#000000" : "#ffffff";
    return { "--recap-slide-bg": background, "--recap-slide-fg": foreground };
  }

  if (slideId === "share") {
    const stops = Array.from({ length: 5 }, (_, position) => {
      const color = palette[position % palette.length];
      return `${color} ${position * 25}%`;
    });
    return { "--recap-mix": `linear-gradient(135deg, ${stops.join(", ")})` };
  }

  return {};
}

export function buildWrappedPaletteTheme(colors) {
  const entries = (Array.isArray(colors) ? colors : [])
    .slice(0, 5)
    .map((entry) => rgb(entry?.hex))
    .filter(Boolean);
  if (!entries.length) return null;

  const byBrightness = entries
    .map((channels, index) => ({ channels, index }))
    .sort((a, b) => luminance(a.channels) - luminance(b.channels));
  const darkest = byBrightness[0];
  const lightest = byBrightness.at(-1);
  const ink = readableShade(darkest.channels, [255, 255, 255], 0, 10);
  const paper = readableShade(lightest.channels, ink, 255, 10);
  // Reserve the darkest and lightest colors, then give each of the other three
  // artwork colors its own slide role in the API's dominance order.
  const middle = entries.filter((_, index) => index !== darkest.index && index !== lightest.index);
  const light = (channels) => hex(readableShade(channels, ink, 255, 7));
  const accents = [0, 1, 2].map((index) => light(middle[index] || entries[index % entries.length]));

  return {
    "--recap-ink": hex(ink),
    "--recap-white": hex(paper),
    "--recap-coral": accents[0],
    "--recap-cyan": accents[1],
    "--recap-yellow": accents[2],
    "--recap-accent": accents[0],
    "--recap-secondary": accents[1],
  };
}

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
  const deviceContributions = Array.isArray(data?.deviceContributions) ? data.deviceContributions : [];
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
    { id: "devices", items: deviceContributions.slice(0, 5), totalCount: deviceContributions.length },
    { id: "persona", persona },
    { id: "share", lead, persona, totalPlayTime: Number(data?.totalPlayTime || 0) },
  ];
}
