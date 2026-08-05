import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronLeft,
  faChevronRight,
  faDownload,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { toBlob } from "html-to-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useGlobalPlayer } from "../components/GlobalPlayer";
import {
  buildWaveformPoints,
  buildWrappedSlides,
  buildWrappedTimeline,
  collectWrappedSlideExports,
  getWrappedSlideFilename,
  getWrappedMediaTitle,
  getWrappedThumbnailUrl,
  isWrappedEmpty,
  WRAPPED_STORY_EXPORT,
} from "./wrapped-story";

const DAY_MS = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Wrapped() {
  const player = useGlobalPlayer();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(null);
  const [view, setView] = useState("story");
  const [storyIndex, setStoryIndex] = useState(0);
  const [exportState, setExportState] = useState(null);
  const [exportError, setExportError] = useState("");
  const exportRefs = useRef([]);

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

  useEffect(() => {
    setData(null);
    setError("");
    setLocked(null);
    const timezoneOffset = new Date().getTimezoneOffset();
    api(`/api/wrapped/current?from=${period.fromIso}&to=${period.toIso}&timezoneOffset=${timezoneOffset}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (response.status === 429 && payload?.code === "WRAPPED_LOCKED") {
          setLocked(payload);
          window.dispatchEvent(new Event("wrapped-access-changed"));
          return null;
        }
        if (!response.ok) throw new Error(`Wrapped request failed (${response.status})`);
        return payload;
      })
      .then((payload) => {
        if (!payload) return;
        setData(payload);
        window.dispatchEvent(new Event("wrapped-access-changed"));
      })
      .catch(() => setError("Could not load your recap. Check the server connection and try again."));
  }, [period]);

  const timeline = useMemo(
    () => buildWrappedTimeline(data, data?.periodStart || period.fromIso),
    [data, period.fromIso]
  );
  const slides = useMemo(() => buildWrappedSlides(data, timeline), [data, timeline]);

  useEffect(() => {
    if (player?.currentMedia) player.stopPlayback?.();
  }, [player?.currentMedia?.id, player?.stopPlayback]);

  const captureSlide = useCallback(async (index) => {
    const node = exportRefs.current[index];
    if (!node) throw new Error("Slide export is not ready");
    await waitForExportAssets(node);
    const blob = await toBlob(node, {
      backgroundColor: "#111318",
      cacheBust: true,
      height: WRAPPED_STORY_EXPORT.cssHeight,
      pixelRatio: WRAPPED_STORY_EXPORT.pixelRatio,
      width: WRAPPED_STORY_EXPORT.cssWidth,
    });
    if (!blob) throw new Error("Image capture returned no data");
    return blob;
  }, []);

  const exportCurrentSlide = useCallback(async () => {
    if (exportState) return;
    setExportState({ kind: "current", current: 1, total: 1 });
    setExportError("");

    try {
      const blob = await captureSlide(storyIndex);
      const filename = getWrappedSlideFilename(slides[storyIndex], storyIndex);
      downloadBlob(blob, filename);
    } catch {
      setExportError("Could not create the recap image. Try downloading again.");
    } finally {
      setExportState(null);
    }
  }, [captureSlide, exportState, slides, storyIndex]);

  const exportAllSlides = useCallback(async () => {
    if (exportState) return;
    setExportError("");
    setExportState({ kind: "all", current: 1, total: slides.length });

    try {
      const exports = await collectWrappedSlideExports(
        slides,
        (_slide, index) => captureSlide(index),
        (current, total) => setExportState({ kind: "all", current, total })
      );
      exports.forEach(({ blob, filename }) => downloadBlob(blob, filename));
    } catch {
      setExportError("Could not create all recap images. No files were downloaded; try again.");
    } finally {
      setExportState(null);
    }
  }, [captureSlide, exportState, slides]);

  if (error) {
    return (
      <PageShell fullscreen>
        <div className="wrapped-error rounded-lg border border-warning-border bg-warning-bg p-5 text-warning-text">
          <h1 className="text-xl font-bold">Wrapped unavailable</h1>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      </PageShell>
    );
  }

  if (locked) {
    return (
      <PageShell fullscreen>
        <EmptyState
          title="Wrapped locked"
          copy={`This playback report can only be opened once every 30 days. ${formatUnlockMessage(locked)}`}
        />
      </PageShell>
    );
  }

  if (!data) return <PageShell fullscreen><LoadingState /></PageShell>;
  if (isWrappedEmpty(data)) {
    return (
      <PageShell fullscreen>
        <EmptyState
          title="Your recap needs a first play"
          copy="Play audio or video from this device. Your next recap will turn those sessions into a playback story."
        />
      </PageShell>
    );
  }

  return (
    <PageShell fullscreen={view === "story"} wide={view === "summary"}>
      <div className="wrapped-viewbar">
        <div className="wrapped-viewbar-main">
          <Link className="wrapped-exit" to="/" aria-label="Close Wrapped" title="Close">
            <FontAwesomeIcon icon={faXmark} />
          </Link>
          <div className="wrapped-view-switch" aria-label="Wrapped view">
            <button type="button" aria-pressed={view === "story"} onClick={() => setView("story")}>Story</button>
            <button type="button" aria-pressed={view === "summary"} onClick={() => setView("summary")}>Summary</button>
          </div>
        </div>
        <span>{period.label} · 30-day recap</span>
      </div>

      {view === "story" ? (
        <>
          <StoryViewer
            data={data}
            index={storyIndex}
            onIndexChange={setStoryIndex}
            periodLabel={period.label}
            slides={slides}
            timeline={timeline}
          />
          <div className="wrapped-download-tools">
            <div className="wrapped-download-actions">
              {storyIndex === slides.length - 1 && (
                <button type="button" disabled={Boolean(exportState)} onClick={exportAllSlides}>
                  <FontAwesomeIcon icon={faDownload} />
                  Download all
                </button>
              )}
              <button type="button" disabled={Boolean(exportState)} onClick={exportCurrentSlide}>
                <FontAwesomeIcon icon={faDownload} />
                Download slide
              </button>
            </div>
            {exportState && (
              <p className="wrapped-export-status" role="status" aria-live="polite">
                Rendering {exportState.current} of {exportState.total}
              </p>
            )}
            {exportError && <p role="alert">{exportError}</p>}
          </div>
        </>
      ) : (
        <SummaryDashboard data={data} periodLabel={period.label} timeline={timeline} />
      )}

      <div className="wrapped-export-root" aria-hidden="true">
        {slides.map((slide, index) => (
          <div
            key={slide.id}
            ref={(node) => { exportRefs.current[index] = node; }}
            className="wrapped-export-slide"
            style={{
              "--recap-accent": data.persona?.palette?.accent || "#FF5A5F",
              "--recap-secondary": data.persona?.palette?.secondary || "#2DC7C9",
            }}
          >
            <StorySlide data={data} periodLabel={period.label} slide={slide} timeline={timeline} />
          </div>
        ))}
      </div>
    </PageShell>
  );
}

function StoryViewer({ data, index, onIndexChange, periodLabel, slides, timeline }) {
  const pointerStart = useRef(null);
  const lastIndex = slides.length - 1;
  const goTo = useCallback((nextIndex) => {
    onIndexChange(Math.min(Math.max(nextIndex, 0), lastIndex));
  }, [lastIndex, onIndexChange]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (event.key === "ArrowRight") goTo(index + 1);
      if (event.key === "ArrowLeft") goTo(index - 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goTo, index]);

  const palette = data.persona?.palette || { accent: "#FF5A5F", secondary: "#2DC7C9" };
  const handlePointerUp = (event) => {
    if (pointerStart.current == null) return;
    const distance = event.clientX - pointerStart.current;
    pointerStart.current = null;
    if (Math.abs(distance) < 42) return;
    goTo(distance < 0 ? index + 1 : index - 1);
  };

  return (
    <section className="wrapped-story-shell" style={{ "--recap-accent": palette.accent, "--recap-secondary": palette.secondary }}>
      <div
        className="wrapped-story-stage"
        onPointerDown={(event) => { pointerStart.current = event.clientX; }}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { pointerStart.current = null; }}
      >
        <div className="wrapped-story-progress" aria-label={`Slide ${index + 1} of ${slides.length}`}>
          {slides.map((slide, slideIndex) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Go to slide ${slideIndex + 1}`}
              aria-current={slideIndex === index ? "step" : undefined}
              onClick={() => goTo(slideIndex)}
            ><span /></button>
          ))}
        </div>
        <div key={slides[index].id} className="wrapped-story-frame">
          <StorySlide data={data} periodLabel={periodLabel} slide={slides[index]} timeline={timeline} />
        </div>
        <span className="wrapped-story-count">{String(index + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}</span>
      </div>

      <div className="wrapped-story-navigation">
        <button type="button" aria-label="Previous slide" disabled={index === 0} onClick={() => goTo(index - 1)}>
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
        <p>{storyChapter(slides[index].id)}</p>
        <button type="button" aria-label="Next slide" disabled={index === lastIndex} onClick={() => goTo(index + 1)}>
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
      </div>
    </section>
  );
}

function StorySlide({ data, periodLabel, slide, timeline }) {
  const totals = data.totals || {};
  const rhythm = data.rhythm || {};
  const persona = data.persona || slide.persona;
  const lead = data.topMedia?.[0];

  if (slide.id === "opening") {
    return (
      <article className="wrapped-slide wrapped-slide--opening">
        <Artwork media={lead} className="wrapped-slide-backdrop" />
        <div className="wrapped-slide-shade" />
        <div className="wrapped-slide-copy">
          <span className="wrapped-slide-kicker">DogMedia · {periodLabel}</span>
          <h1>Your 30-day replay</h1>
          <p>{lead ? `${getWrappedMediaTitle(lead)} set the tone.` : "Your library found its rhythm."}</p>
        </div>
      </article>
    );
  }

  if (slide.id === "time") {
    return (
      <article className="wrapped-slide wrapped-slide--time">
        <span className="wrapped-slide-kicker">Time in motion</span>
        <div className="wrapped-big-number">{fmtTime(data.totalPlayTime)}</div>
        <p className="wrapped-slide-lede">tracked across {formatNumber(data.totalPlays)} starts</p>
        <ActivityRibbon timeline={timeline} />
        <dl className="wrapped-slide-stats">
          <SummaryItem label="Active days" value={formatNumber(totals.activeDays)} />
          <SummaryItem label="Media explored" value={formatNumber(totals.distinctMedia)} />
          <SummaryItem label="Average session" value={fmtTime(totals.averageSession)} />
        </dl>
      </article>
    );
  }

  if (slide.id === "top-media") {
    return (
      <article className="wrapped-slide wrapped-slide--top">
        <span className="wrapped-slide-kicker">Your rotation</span>
        <h2>Five titles stayed close</h2>
        <div className="wrapped-contact-sheet">
          {(data.topMedia || []).map((media, mediaIndex) => (
            <div key={media.mediaId || mediaIndex} className={mediaIndex === 0 ? "wrapped-contact wrapped-contact--lead" : "wrapped-contact"}>
              <Artwork media={media} />
              <span>{mediaIndex + 1}</span>
              <strong>{getWrappedMediaTitle(media)}</strong>
            </div>
          ))}
        </div>
      </article>
    );
  }

  if (slide.id === "rhythm") {
    return (
      <article className="wrapped-slide wrapped-slide--rhythm">
        <span className="wrapped-slide-kicker">Your listening clock</span>
        <div className="wrapped-clock-value">{formatHour(rhythm.peakHour)}</div>
        <p className="wrapped-slide-lede">was your strongest hour</p>
        <div className="wrapped-rhythm-grid">
          <div><span>Best weekday</span><strong>{weekdayLabel(rhythm.busiestWeekday?.dayIndex)}</strong></div>
          <div><span>Longest streak</span><strong>{rhythm.longestStreak || 0} days</strong></div>
          <div><span>After dark</span><strong>{Math.round((rhythm.nightShare || 0) * 100)}%</strong></div>
          <div><span>Top folder</span><strong>{data.topCategories?.[0]?.name || "Still forming"}</strong></div>
        </div>
      </article>
    );
  }

  if (slide.id === "persona") {
    return (
      <article className="wrapped-slide wrapped-slide--persona">
        <span className="wrapped-slide-kicker">Your playback character</span>
        <p className="wrapped-persona-mark" aria-hidden="true">{persona?.title?.slice(0, 1) || "S"}</p>
        <h2>{persona?.title || "Steady Signal"}</h2>
        <p className="wrapped-persona-copy">{persona?.description || "Your playback rhythm is still taking shape."}</p>
        <div className="wrapped-persona-rule" />
        <p>{formatNumber(totals.distinctMedia)} titles · {formatNumber(totals.activeDays)} active days</p>
      </article>
    );
  }

  return (
    <article className="wrapped-slide wrapped-slide--final">
      <div className="wrapped-final-art"><Artwork media={lead} /></div>
      <span className="wrapped-slide-kicker">DogMedia · 30-day recap</span>
      <h2>{persona?.title || "Steady Signal"}</h2>
      <div className="wrapped-final-stats">
        <div><strong>{fmtTime(data.totalPlayTime)}</strong><span>play time</span></div>
        <div><strong>{formatNumber(data.totalPlays)}</strong><span>plays</span></div>
      </div>
      <p className="wrapped-final-title">Top play: {getWrappedMediaTitle(lead)}</p>
    </article>
  );
}

function ActivityRibbon({ timeline }) {
  return (
    <svg className="wrapped-ribbon" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Thirty-day playback activity">
      <line x1="0" y1="39" x2="100" y2="39" />
      <polyline points={buildWaveformPoints(timeline)} />
    </svg>
  );
}

function Artwork({ className = "", media }) {
  const [failed, setFailed] = useState(false);
  const src = getWrappedThumbnailUrl(media);
  if (!src || failed) {
    return <div className={`wrapped-artwork-fallback ${className}`} aria-hidden="true"><span>{getWrappedMediaTitle(media).slice(0, 1)}</span></div>;
  }
  return <img className={className} src={src} alt="" onError={() => setFailed(true)} />;
}

function SummaryDashboard({ data, periodLabel, timeline }) {
  const topMedia = data.topMedia || [];
  const totalPlayTime = data.totalPlayTime || 0;
  const totalPlays = data.totalPlays || 0;
  const activeDays = data.totals?.activeDays ?? timeline.filter((day) => day.playTime || day.plays).length;
  const maxDayTime = Math.max(...timeline.map((day) => day.playTime), 1);
  const maxMediaTime = Math.max(...topMedia.map((media) => media.totalTime || 0), 1);
  const busiestDay = data.rhythm?.busiestDay || [...timeline].sort((a, b) => b.playTime - a.playTime)[0];

  return (
    <div className="wrapped-summary-view">
      <section className="wrapped-hero">
        <div className="wrapped-hero-copy">
          <p className="wrapped-eyebrow">This device · {periodLabel}</p>
          <h1>Your playback pulse</h1>
          <p className="wrapped-subtitle">A detailed view of the same 30-day story.</p>
        </div>
        <div className="wrapped-hero-stats">
          <Metric label="Play time" value={fmtTime(totalPlayTime)} />
          <Metric label="Plays" value={formatNumber(totalPlays)} />
          <Metric label="Active days" value={formatNumber(activeDays)} />
          <Metric label="Streak" value={`${data.rhythm?.longestStreak || 0}d`} />
        </div>
      </section>

      <div className="wrapped-dashboard">
        <section className="wrapped-panel wrapped-panel--story">
          <div className="wrapped-story-main">
            <span className="wrapped-story-label">Most played</span>
            <h2>{getWrappedMediaTitle(topMedia[0])}</h2>
            <p>{topMedia[0] ? `${formatNumber(topMedia[0].playCount)} plays · ${fmtTime(topMedia[0].totalTime)} tracked` : "Keep listening to build a ranked history."}</p>
          </div>
          <dl className="wrapped-story-side">
            <SummaryItem label="Persona" value={data.persona?.title || "Steady Signal"} />
            <SummaryItem label="Peak hour" value={formatHour(data.rhythm?.peakHour)} />
            <SummaryItem label="Peak day" value={busiestDay?.playTime ? formatLongDate(busiestDay.date) : "None"} />
          </dl>
        </section>

        <section className="wrapped-panel wrapped-panel--main">
          <div className="wrapped-section-heading"><div><h2>Playback rhythm</h2><p>Thirty days of tracked sessions</p></div><span>{fmtTime(data.totals?.averageSession)} average session</span></div>
          <DailyPulse timeline={timeline} maxDayTime={maxDayTime} />
          <ActivityHeatmap timeline={timeline} maxDayTime={maxDayTime} />
        </section>
        <aside className="wrapped-panel"><div className="wrapped-section-heading"><div><h2>Top folders</h2><p>Ranked by tracked time</p></div></div><CategoryList categories={data.topCategories || []} /></aside>
        <section className="wrapped-panel wrapped-panel--main"><div className="wrapped-section-heading"><div><h2>Top media</h2><p>Ranked by tracked time</p></div></div><TopMediaList media={topMedia} maxMediaTime={maxMediaTime} /></section>
        <aside className="wrapped-panel"><div className="wrapped-section-heading"><div><h2>Milestones</h2><p>Moments from this recap</p></div></div><dl className="wrapped-summary-list"><SummaryItem label="First play" value={data.milestones?.firstPlayAt ? formatLongDate(data.milestones.firstPlayAt) : "None"} /><SummaryItem label="Biggest day" value={busiestDay?.date ? formatLongDate(busiestDay.date) : "None"} /><SummaryItem label="Media explored" value={formatNumber(data.totals?.distinctMedia)} /><SummaryItem label="After dark" value={`${Math.round((data.rhythm?.nightShare || 0) * 100)}%`} /></dl></aside>
      </div>
    </div>
  );
}

function DailyPulse({ timeline, maxDayTime }) {
  return <div className="wrapped-pulse" aria-label="Daily playback time">{timeline.map((day) => <span key={day.date} className="wrapped-pulse-day" style={{ "--pulse-height": `${Math.max((day.playTime / maxDayTime) * 100, day.playTime ? 12 : 0)}%` }} title={`${formatLongDate(day.date)}: ${fmtTime(day.playTime)}`}><span /></span>)}</div>;
}

function ActivityHeatmap({ timeline, maxDayTime }) {
  const cells = buildHeatmapCells(timeline, maxDayTime);
  return <div className="wrapped-heatmap-shell"><div className="wrapped-heatmap"><div className="wrapped-heatmap-weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div><div className="wrapped-heatmap-grid" role="img" aria-label="Playback contribution heatmap">{cells.map((cell, index) => <span key={cell.date || `empty-${index}`} className={cell.empty ? "wrapped-heatmap-cell wrapped-heatmap-cell--empty" : "wrapped-heatmap-cell"} data-level={cell.level} title={cell.empty ? "" : `${formatLongDate(cell.date)}: ${fmtTime(cell.playTime)}`} />)}</div></div></div>;
}

function TopMediaList({ media, maxMediaTime }) {
  if (!media.length) return <p className="wrapped-empty-note">Top media will appear after playback events are recorded.</p>;
  return <ol className="wrapped-media-list">{media.map((item, index) => <li key={item.mediaId || index}><span className="wrapped-rank">{index + 1}</span><div className="min-w-0 flex-1"><div className="wrapped-media-title" title={getWrappedMediaTitle(item)}>{getWrappedMediaTitle(item)}</div><div className="wrapped-media-meta">{formatNumber(item.playCount)} plays · {fmtTime(item.totalTime)}</div><div className="wrapped-media-bar"><span style={{ width: `${Math.max((item.totalTime / maxMediaTime) * 100, 3)}%` }} /></div></div></li>)}</ol>;
}

function CategoryList({ categories }) {
  if (!categories.length) return <p className="wrapped-empty-note">Folder activity will appear after tracked playback.</p>;
  return <ol className="wrapped-category-list">{categories.map((category) => <li key={category.categoryId ?? category.name}><span>{category.rank}</span><div><strong>{category.name}</strong><small>{fmtTime(category.totalTime)} · {formatNumber(category.playCount)} plays</small></div></li>)}</ol>;
}

function PageShell({ children, fullscreen = false, wide = false }) {
  return (
    <div className={fullscreen ? "premium-app-shell wrapped-shell wrapped-shell--fullscreen" : "premium-app-shell wrapped-shell"}>
      <main className={`app-main wrapped-page${fullscreen ? " wrapped-page--fullscreen" : ""}${wide ? " wrapped-page--wide" : ""}`}>{children}</main>
    </div>
  );
}

function LoadingState() {
  return <div className="wrapped-loading" aria-label="Loading recap"><div /><div /><div /></div>;
}

function EmptyState({ copy, title }) {
  return <section className="wrapped-empty"><div className="wrapped-empty-mark" aria-hidden="true" /><h2>{title}</h2><p>{copy}</p></section>;
}

function Metric({ label, value }) {
  return <div className="wrapped-metric"><div>{label}</div><strong>{value}</strong></div>;
}

function SummaryItem({ label, value }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function buildHeatmapCells(timeline, maxDayTime) {
  const firstDay = timeline[0]?.dateObject?.getDay?.() || 0;
  const cells = Array.from({ length: firstDay }, () => ({ empty: true, level: 0 }));
  timeline.forEach((day) => cells.push({ ...day, level: getActivityLevel(day.playTime, maxDayTime) }));
  while (cells.length % 7 !== 0) cells.push({ empty: true, level: 0 });
  return cells;
}

function getActivityLevel(value, maxValue) {
  if (!value) return 0;
  const ratio = value / Math.max(maxValue, 1);
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.45) return 3;
  if (ratio >= 0.18) return 2;
  return 1;
}

function storyChapter(id) {
  return ({ opening: "Opening", time: "Time in motion", "top-media": "Your rotation", rhythm: "Listening clock", persona: "Playback character", share: "Final recap" })[id] || "Recap";
}

function fmtTime(seconds) {
  const value = Math.max(Math.floor(Number(seconds) || 0), 0);
  if (!value) return "0m";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${value}s`;
}

function formatHour(hour) {
  if (!Number.isInteger(hour)) return "No peak yet";
  return new Date(Date.UTC(2026, 0, 1, hour)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });
}

function weekdayLabel(dayIndex) {
  return Number.isInteger(dayIndex) ? WEEKDAYS[dayIndex] : "Still forming";
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

function formatLongDate(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" }) : "";
}

function formatUnlockMessage(locked) {
  const nextOpenDate = formatLongDate(locked?.nextOpenAt);
  if (!nextOpenDate) return "Check back later.";
  const days = Math.max(Math.ceil(((locked.retryAfterSeconds || 0) * 1000) / DAY_MS), 0);
  return days > 0 ? `Come back ${nextOpenDate}, in about ${days === 1 ? "1 day" : `${days} days`}.` : `Come back ${nextOpenDate}.`;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

async function waitForExportAssets(node) {
  await document.fonts?.ready;
  await Promise.all([...node.querySelectorAll("img")].map(async (image) => {
    if (!image.complete) await new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
    await image.decode?.().catch(() => {});
  }));
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
