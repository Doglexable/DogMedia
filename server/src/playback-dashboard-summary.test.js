import { describe, expect, it } from "vitest";
import { buildDashboardSummary } from "./playback-dashboard-summary.js";

function mediaItem(id, overrides = {}) {
  return {
    id,
    title: overrides.title || `Media ${id}`,
    createdAt: overrides.createdAt || "2026-01-01T00:00:00.000Z",
    playCount: overrides.playCount || 0,
    totalTime: overrides.totalTime || 0,
    lastPlayedAt: overrides.lastPlayedAt || null,
    playbackScore: overrides.playbackScore || 0,
  };
}

describe("buildDashboardSummary", () => {
  it("orders recently played and most played independently", () => {
    const summary = buildDashboardSummary([
      mediaItem(1, {
        playCount: 2,
        totalTime: 120,
        playbackScore: 480,
        lastPlayedAt: "2026-08-14T10:00:00.000Z",
      }),
      mediaItem(2, {
        playCount: 8,
        totalTime: 900,
        playbackScore: 2340,
        lastPlayedAt: "2026-08-12T10:00:00.000Z",
      }),
      mediaItem(3, {
        playCount: 1,
        totalTime: 30,
        playbackScore: 210,
        lastPlayedAt: "2026-08-15T10:00:00.000Z",
      }),
    ]);

    expect(summary.rows[0]).toMatchObject({
      key: "recently-played",
      title: "Recently played",
      mediaIds: [3, 1, 2],
    });
    expect(summary.rows[1]).toMatchObject({
      key: "top-media",
      title: "Most played",
      mediaIds: [2, 1, 3],
    });
  });

  it("keeps playback row titles and fills them with folder items when history is absent", () => {
    const summary = buildDashboardSummary([
      mediaItem(41, { createdAt: "2026-08-01T00:00:00.000Z" }),
      mediaItem(42, { createdAt: "2026-08-03T00:00:00.000Z" }),
    ], {
      categoryId: 7,
      refreshIntervalSeconds: 1800,
    });

    expect(summary.filters.categoryId).toBe(7);
    expect(summary.refreshIntervalSeconds).toBe(1800);
    expect(summary.rows).toEqual([
      {
        key: "recently-played",
        title: "Recently played",
        type: "square",
        mediaIds: [42, 41],
      },
      {
        key: "top-media",
        title: "Most played",
        type: "square",
        mediaIds: [42, 41],
      },
    ]);
  });

  it("cannot include media outside the supplied active-folder dataset", () => {
    const folderMedia = [mediaItem(71), mediaItem(72)];
    const summary = buildDashboardSummary(folderMedia, { categoryId: 9 });
    const returnedIds = new Set([
      summary.featuredId,
      ...summary.quickAccessIds,
      ...summary.rows.flatMap((row) => row.mediaIds),
    ]);

    expect(returnedIds).toEqual(new Set([71, 72]));
    expect(returnedIds.has(99)).toBe(false);
  });
});
