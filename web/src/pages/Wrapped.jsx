import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const DAY_MS = 86400000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Wrapped() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

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
    api(`/api/playback/wrapped?from=${period.fromIso}&to=${period.toIso}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Wrapped request failed (${r.status})`);
        return r.json();
      })
      .then(setData)
      .catch(() => setError("Could not load wrapped data."));
  }, [period]);

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

  if (error) {
    return (
      <PageShell>
        <div className="rounded-lg border border-warning-border bg-warning-bg p-5 text-warning-text">
          <h1 className="text-xl font-bold">Wrapped unavailable</h1>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      </PageShell>
    );
  }

  if (!data) {
    return (
      <PageShell>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="h-80 animate-pulse rounded-lg border border-card-border bg-card" />
          <div className="h-80 animate-pulse rounded-lg border border-card-border bg-card" />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-lg border border-card-border bg-card" />
          ))}
        </div>
      </PageShell>
    );
  }

  const topMedia = data.topMedia || [];
  const totalPlayTime = data.totalPlayTime || 0;
  const totalPlays = data.totalPlays || 0;
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
  const isEmpty = totalPlayTime === 0 && totalPlays === 0 && topMedia.length === 0;
  const leadMedia = topMedia[0];

  return (
    <PageShell>
      <section className="wrapped-hero">
        <div className="wrapped-hero-copy">
          <p className="wrapped-eyebrow">Last 30 days</p>
          <h1>Your playback pulse</h1>
          <p className="wrapped-subtitle">
            {period.label} / {activeDays ? `${activeDays} active days` : "No active days yet"}
          </p>
        </div>
        <div className="wrapped-hero-stats">
          <Metric label="Play time" value={fmtTime(totalPlayTime)} />
          <Metric label="Plays" value={formatNumber(totalPlays)} />
          <Metric label="Density" value={`${listeningDensity}%`} />
          <Metric label="Streak" value={`${currentStreak}d`} />
        </div>
      </section>

      {isEmpty ? (
        <section className="wrapped-empty">
          <div className="wrapped-empty-mark" aria-hidden="true" />
          <h2>No playback activity yet</h2>
          <p>Play audio or video files and this page will build a playback report from your sessions.</p>
        </section>
      ) : (
        <div className="wrapped-dashboard">
          <section className="wrapped-panel wrapped-panel--story">
            <div className="wrapped-story-main">
              <span className="wrapped-story-label">Most played</span>
              <h2>{leadMedia?.title || "No top media yet"}</h2>
              <p>
                {leadMedia
                  ? `${formatNumber(leadMedia.playCount || 0)} plays / ${fmtTime(leadMedia.totalTime || 0)} tracked`
                  : "Keep listening to build a ranked history."}
              </p>
            </div>
            <dl className="wrapped-story-side">
              <SummaryItem label="Daily average" value={fmtTime(Math.floor(totalPlayTime / 30))} />
              <SummaryItem label="Best weekday" value={busiestWeekday.label} />
              <SummaryItem label="Peak day" value={busiestDay?.playTime ? formatLongDate(busiestDay.date) : "None"} />
            </dl>
          </section>

          <section className="wrapped-panel wrapped-panel--main">
            <div className="wrapped-section-heading">
              <div>
                <h2>Playback rhythm</h2>
                <p>
                  {formatNumber(totalPlays)} events / peak {busiestDay?.playTime ? `${formatLongDate(busiestDay.date)} at ${fmtTime(busiestDay.playTime)}` : "None yet"}
                </p>
              </div>
              <span>{fmtTime(activeDays ? Math.floor(totalPlayTime / activeDays) : 0)} active-day avg</span>
            </div>

            <DailyPulse timeline={timeline} maxDayTime={maxDayTime} />
            <ActivityHeatmap timeline={timeline} maxDayTime={maxDayTime} />
          </section>

          <aside className="wrapped-panel">
            <div className="wrapped-section-heading">
              <div>
                <h2>Activity feed</h2>
                <p>Recent playback days</p>
              </div>
            </div>
            <ActivityFeed days={activityDays} maxDayTime={maxDayTime} />
          </aside>

          <section className="wrapped-panel wrapped-panel--main">
            <div className="wrapped-section-heading">
              <div>
                <h2>Top media</h2>
                <p>Ranked by tracked play time</p>
              </div>
            </div>
            <TopMediaList media={topMedia} maxMediaTime={maxMediaTime} />
          </section>

          <aside className="wrapped-panel">
            <div className="wrapped-section-heading">
              <div>
                <h2>Summary</h2>
                <p>Thirty-day profile</p>
              </div>
            </div>
            <dl className="wrapped-summary-list">
              <SummaryItem label="Active-day average" value={fmtTime(activeDays ? Math.floor(totalPlayTime / activeDays) : 0)} />
              <SummaryItem label="Peak play time" value={fmtTime(busiestDay?.playTime || 0)} />
              <SummaryItem label="Active days" value={`${activeDays}/30`} />
              <SummaryItem label="Best weekday time" value={fmtTime(busiestWeekday.playTime)} />
            </dl>
          </aside>
        </div>
      )}
    </PageShell>
  );
}

function DailyPulse({ timeline, maxDayTime }) {
  return (
    <div className="wrapped-pulse" aria-label="Daily playback time">
      {timeline.map((day) => {
        const pct = Math.max((day.playTime / maxDayTime) * 100, day.playTime ? 12 : 0);
        return (
          <span
            key={day.date}
            className="wrapped-pulse-day"
            style={{ "--pulse-height": `${pct}%` }}
            title={`${formatLongDate(day.date)}: ${fmtTime(day.playTime)} across ${formatNumber(day.plays)} plays`}
          >
            <span />
          </span>
        );
      })}
    </div>
  );
}

function ActivityHeatmap({ timeline, maxDayTime }) {
  const cells = buildHeatmapCells(timeline, maxDayTime);

  return (
    <div className="wrapped-heatmap-shell">
      <div className="wrapped-heatmap">
        <div className="wrapped-heatmap-weekdays" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="wrapped-heatmap-grid" role="img" aria-label="Playback contribution heatmap">
          {cells.map((cell, index) => (
            <span
              key={cell.date || `empty-${index}`}
              className={cell.empty ? "wrapped-heatmap-cell wrapped-heatmap-cell--empty" : "wrapped-heatmap-cell"}
              data-level={cell.level}
              style={{ "--wrapped-index": index }}
              title={cell.empty ? "" : `${formatLongDate(cell.date)}: ${fmtTime(cell.playTime)} across ${formatNumber(cell.plays)} plays`}
            />
          ))}
        </div>
      </div>
      <div className="wrapped-heatmap-footer">
        <span>Less</span>
        <span className="wrapped-heatmap-cell" data-level="1" />
        <span className="wrapped-heatmap-cell" data-level="2" />
        <span className="wrapped-heatmap-cell" data-level="3" />
        <span className="wrapped-heatmap-cell" data-level="4" />
        <span>More</span>
      </div>
    </div>
  );
}

function ActivityFeed({ days, maxDayTime }) {
  if (days.length === 0) {
    return <p className="wrapped-empty-note">Activity will appear after playback events are recorded.</p>;
  }

  return (
    <ol className="wrapped-activity-feed">
      {days.slice(0, 8).map((day, index) => {
        const pct = Math.max((day.playTime / maxDayTime) * 100, 8);
        return (
          <li key={day.date} style={{ "--wrapped-index": index }}>
            <time className="wrapped-feed-date" dateTime={day.date}>
              <span>{day.dayName}</span>
              <strong>{new Date(day.date).getDate()}</strong>
            </time>
            <div className="min-w-0 flex-1">
              <div className="wrapped-feed-title">{formatLongDate(day.date)}</div>
              <div className="wrapped-feed-meta">
                {fmtTime(day.playTime)} / {formatNumber(day.plays)} plays
              </div>
              <div className="wrapped-feed-bar">
                <span style={{ width: `${pct}%` }} />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TopMediaList({ media, maxMediaTime }) {
  if (media.length === 0) {
    return <p className="wrapped-empty-note">Top media will appear after playback events are recorded.</p>;
  }

  return (
    <ol className="wrapped-media-list">
      {media.map((item, index) => {
        const pct = Math.max(((item.totalTime || 0) / maxMediaTime) * 100, 3);
        return (
          <li key={item.mediaId || index} style={{ "--wrapped-index": index }}>
            <span className="wrapped-rank">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="wrapped-media-title" title={item.title || `Media #${item.mediaId}`}>
                {item.title || `Media #${item.mediaId}`}
              </div>
              <div className="wrapped-media-meta">
                {formatNumber(item.playCount || 0)} plays / {fmtTime(item.totalTime || 0)}
              </div>
              <div className="wrapped-media-bar">
                <span style={{ width: `${pct}%` }} />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
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

function PageShell({ children }) {
  return (
    <div className="premium-app-shell min-h-screen bg-surface text-content">
      <header className="app-header sticky top-0 z-[100] flex min-h-[var(--app-header-height)] flex-wrap items-center gap-3 border-b border-card-border bg-card px-3 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="truncate text-[var(--fs-md)] font-extrabold tracking-normal text-content">Wrapped</div>
            <div className="truncate text-xs text-muted">Playback activity and contribution history</div>
          </div>
        </div>
      </header>
      <main className="app-main mx-auto max-w-6xl px-4 py-7">
        {children}
      </main>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="wrapped-metric">
      <div>{label}</div>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
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

function getActivityLevel(value, maxValue) {
  if (!value) return 0;
  const ratio = value / Math.max(maxValue, 1);
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.45) return 3;
  if (ratio >= 0.18) return 2;
  return 1;
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

function fmtTime(sec) {
  if (!sec) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatLongDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", weekday: "short" });
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}
