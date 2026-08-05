import { describe, expect, it } from "vitest";
import {
  acquireWrappedAccessLock,
  aggregateWrappedEvents,
  deriveWrappedPersona,
  getAnnualWrappedAvailability,
  getWrappedAccessStatus,
} from "./wrapped.js";

const DAY_MS = 86400000;
const LOCK_MS = 30 * DAY_MS;

function createLockClient(now, locks = new Map()) {
  return {
    locks,
    async query(_sql, [clientIp]) {
      const existing = locks.get(clientIp);
      if (!existing || new Date(existing.next_open_at).getTime() <= now.getTime()) {
        const lastOpenedAt = now.toISOString();
        const nextOpenAt = new Date(now.getTime() + LOCK_MS).toISOString();
        const lock = {
          last_opened_at: lastOpenedAt,
          next_open_at: nextOpenAt,
        };

        locks.set(clientIp, lock);
        return { rows: [{ allowed: true, ...lock }] };
      }

      return { rows: [{ allowed: false, ...existing }] };
    },
  };
}

function createStatusClient(rows) {
  return {
    async query() {
      return { rows };
    },
  };
}

describe("acquireWrappedAccessLock", () => {
  it("allows the first request from an IP and writes a lock", async () => {
    const now = new Date("2026-08-04T00:00:00.000Z");
    const client = createLockClient(now);

    const access = await acquireWrappedAccessLock(client, "192.168.1.10");

    expect(access).toEqual({
      allowed: true,
      lastOpenedAt: "2026-08-04T00:00:00.000Z",
      nextOpenAt: "2026-09-03T00:00:00.000Z",
    });
    expect(client.locks.has("192.168.1.10")).toBe(true);
  });

  it("locks the same IP before 30 days have passed", async () => {
    const firstOpen = new Date("2026-08-04T00:00:00.000Z");
    const locks = new Map();
    await acquireWrappedAccessLock(createLockClient(firstOpen, locks), "192.168.1.10");

    const nextOpen = new Date("2026-08-20T00:00:00.000Z");
    const access = await acquireWrappedAccessLock(createLockClient(nextOpen, locks), "192.168.1.10");

    expect(access).toEqual({
      allowed: false,
      lastOpenedAt: "2026-08-04T00:00:00.000Z",
      nextOpenAt: "2026-09-03T00:00:00.000Z",
    });
  });

  it("allows the same IP after next_open_at and refreshes the lock", async () => {
    const firstOpen = new Date("2026-08-04T00:00:00.000Z");
    const locks = new Map();
    await acquireWrappedAccessLock(createLockClient(firstOpen, locks), "192.168.1.10");

    const unlockedAt = new Date("2026-09-03T00:00:00.000Z");
    const access = await acquireWrappedAccessLock(createLockClient(unlockedAt, locks), "192.168.1.10");

    expect(access).toEqual({
      allowed: true,
      lastOpenedAt: "2026-09-03T00:00:00.000Z",
      nextOpenAt: "2026-10-03T00:00:00.000Z",
    });
  });

  it("keeps locks independent by IP", async () => {
    const firstOpen = new Date("2026-08-04T00:00:00.000Z");
    const locks = new Map();
    await acquireWrappedAccessLock(createLockClient(firstOpen, locks), "192.168.1.10");

    const nextOpen = new Date("2026-08-20T00:00:00.000Z");
    const access = await acquireWrappedAccessLock(createLockClient(nextOpen, locks), "192.168.1.11");

    expect(access.allowed).toBe(true);
    expect(access.lastOpenedAt).toBe("2026-08-20T00:00:00.000Z");
    expect(locks.size).toBe(2);
  });
});

describe("getWrappedAccessStatus", () => {
  it("reports available without creating a lock when the IP has not opened Wrapped", async () => {
    const status = await getWrappedAccessStatus(createStatusClient([]), "192.168.1.10");

    expect(status).toEqual({
      available: true,
      lastOpenedAt: null,
      nextOpenAt: null,
      retryAfterSeconds: 0,
    });
  });

  it("reports unavailable lock metadata for an IP inside the cooldown", async () => {
    const status = await getWrappedAccessStatus(
      createStatusClient([
        {
          available: false,
          last_opened_at: "2026-08-04T00:00:00.000Z",
          next_open_at: "2026-09-03T00:00:00.000Z",
          retry_after_seconds: 2592000,
        },
      ]),
      "192.168.1.10"
    );

    expect(status).toEqual({
      available: false,
      lastOpenedAt: "2026-08-04T00:00:00.000Z",
      nextOpenAt: "2026-09-03T00:00:00.000Z",
      retryAfterSeconds: 2592000,
    });
  });
});

describe("getAnnualWrappedAvailability", () => {
  it("does not replace monthly Wrapped outside December", () => {
    expect(getAnnualWrappedAvailability(new Date("2026-11-30T23:59:59.000Z"))).toBeNull();
    expect(getAnnualWrappedAvailability(new Date("2027-01-01T00:00:00.000Z"))).toBeNull();
  });

  it("locks December 1 through 14 until December 15 of the same year", () => {
    const status = getAnnualWrappedAvailability(new Date("2026-12-14T12:00:00.000Z"));

    expect(status).toMatchObject({
      available: false,
      wrappedKind: "annual",
      nextOpenAt: "2026-12-15T00:00:00.000Z",
      period: { kind: "annual-year" },
    });
    expect(status.retryAfterSeconds).toBe(43200);
  });

  it("opens annual Wrapped only on December 15 with a one-year period", () => {
    const status = getAnnualWrappedAvailability(new Date("2026-12-15T12:00:00.000Z"));

    expect(status).toMatchObject({
      available: true,
      wrappedKind: "annual",
      nextOpenAt: null,
      period: {
        kind: "annual-year",
        days: 366,
        start: "2025-12-15T00:00:00.000Z",
        end: "2026-12-15T23:59:59.999Z",
      },
    });
  });

  it("locks December 16 through 31 until December 15 of the next year", () => {
    const status = getAnnualWrappedAvailability(new Date("2026-12-16T00:00:00.000Z"));

    expect(status).toMatchObject({
      available: false,
      wrappedKind: "annual",
      nextOpenAt: "2027-12-15T00:00:00.000Z",
      period: { kind: "annual-year" },
    });
  });
});

function playbackEvent(id, action, position, occurredAt, overrides = {}) {
  return {
    id,
    media_id: overrides.mediaId ?? 7,
    media_title: overrides.title ?? "Long Play",
    category_id: overrides.categoryId ?? 2,
    category_name: overrides.categoryName ?? "Albums",
    action,
    position,
    duration: overrides.duration ?? 3600,
    occurred_at: occurredAt,
  };
}

describe("aggregateWrappedEvents", () => {
  const from = new Date("2026-07-01T00:00:00.000Z");
  const to = new Date("2026-07-30T23:59:59.000Z");

  it("counts repeated play-pause segments without summing absolute positions", () => {
    const report = aggregateWrappedEvents([
      playbackEvent(1, "play", 0, "2026-07-10T10:00:00.000Z"),
      playbackEvent(2, "pause", 60, "2026-07-10T10:01:00.000Z"),
      playbackEvent(3, "play", 60, "2026-07-10T10:02:00.000Z"),
      playbackEvent(4, "pause", 120, "2026-07-10T10:03:00.000Z"),
    ], from, to);

    expect(report.totalPlayTime).toBe(120);
    expect(report.totalPlays).toBe(2);
    expect(report.topMedia[0]).toMatchObject({ playCount: 2, totalTime: 120 });
    expect(report.timeline[0]).toMatchObject({ plays: 2, playTime: 120 });
  });

  it("accepts skip and end terminals and caps forward seeks by elapsed time", () => {
    const report = aggregateWrappedEvents([
      playbackEvent(1, "play", 10, "2026-07-10T22:00:00.000Z"),
      playbackEvent(2, "skip", 1000, "2026-07-10T22:00:20.000Z"),
      playbackEvent(3, "play", 0, "2026-07-11T22:00:00.000Z", { mediaId: 8 }),
      playbackEvent(4, "end", 30, "2026-07-11T22:00:30.000Z", { mediaId: 8 }),
    ], from, to);

    expect(report.totalPlayTime).toBe(50);
    expect(report.rhythm.peakHour).toBe(22);
    expect(report.rhythm.nightShare).toBe(1);
    expect(report.rhythm.longestStreak).toBe(2);
  });

  it("ranks categories by tracked time and keeps plays without terminals", () => {
    const report = aggregateWrappedEvents([
      playbackEvent(1, "play", 0, "2026-07-10T10:00:00.000Z", { categoryId: 2, categoryName: "Albums" }),
      playbackEvent(2, "pause", 50, "2026-07-10T10:00:50.000Z", { categoryId: 2, categoryName: "Albums" }),
      playbackEvent(3, "play", 0, "2026-07-12T10:00:00.000Z", { mediaId: 9, categoryId: 3, categoryName: "Films" }),
    ], from, to);

    expect(report.topCategories[0]).toMatchObject({ name: "Albums", totalTime: 50 });
    expect(report.totalPlays).toBe(2);
    expect(report.totals.activeDays).toBe(2);
    expect(report.milestones.firstPlayAt).toBe("2026-07-10T10:00:00.000Z");
  });

  it("groups rhythm using the browser timezone offset", () => {
    const report = aggregateWrappedEvents([
      playbackEvent(1, "play", 0, "2026-07-10T17:00:00.000Z"),
      playbackEvent(2, "pause", 60, "2026-07-10T17:01:00.000Z"),
    ], from, to, { timezoneOffset: -420 });

    expect(report.rhythm.peakHour).toBe(0);
    expect(report.timeline[0].date).toBe("2026-07-11");
    expect(report.period.timezoneOffset).toBe(-420);
  });

  it("can describe an annual Wrapped period", () => {
    const report = aggregateWrappedEvents(
      [],
      new Date("2025-12-15T00:00:00.000Z"),
      new Date("2026-12-15T23:59:59.999Z"),
      { periodKind: "annual-year", periodDays: 366 }
    );

    expect(report.period).toMatchObject({
      kind: "annual-year",
      days: 366,
      start: "2025-12-15T00:00:00.000Z",
      end: "2026-12-15T23:59:59.999Z",
    });
  });

  it("returns a complete empty report", () => {
    const report = aggregateWrappedEvents([], from, to);
    expect(report).toMatchObject({
      totalPlayTime: 0,
      totalPlays: 0,
      topMedia: [],
      timeline: [],
      topCategories: [],
      rhythm: { peakHour: null, longestStreak: 0 },
      milestones: { firstPlayAt: null, biggestDay: null },
    });
  });
});

describe("deriveWrappedPersona", () => {
  const baseline = { totalPlayTime: 3600, averageSession: 600, distinctMedia: 4, leadShare: 0.25, nightShare: 0.1 };

  it.each([
    ["night-listener", { ...baseline, nightShare: 0.5 }],
    ["loyalist", { ...baseline, leadShare: 0.5 }],
    ["explorer", { ...baseline, distinctMedia: 8, leadShare: 0.2 }],
    ["deep-diver", { ...baseline, averageSession: 1200 }],
    ["steady-signal", baseline],
    ["steady-signal", { ...baseline, totalPlayTime: 1799, nightShare: 1 }],
  ])("returns %s for the matching threshold", (expected, metrics) => {
    expect(deriveWrappedPersona(metrics).key).toBe(expected);
  });

  it("applies the minimum listening time and persona priority at their boundaries", () => {
    expect(deriveWrappedPersona({ ...baseline, totalPlayTime: 1800, nightShare: 0.5 }).key).toBe("night-listener");
    expect(deriveWrappedPersona({ ...baseline, nightShare: 0.5, leadShare: 0.8, averageSession: 1800 }).key).toBe("night-listener");
    expect(deriveWrappedPersona({ ...baseline, leadShare: 0.5, distinctMedia: 12, averageSession: 1800 }).key).toBe("loyalist");
  });
});
