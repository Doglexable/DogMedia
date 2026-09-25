import { describe, expect, it } from "vitest";
import { LyricsValidationError, normalizeWhisperLyrics, upsertUploadedLyrics } from "./lyrics.js";
import {
  DEFAULT_LRCLIB_API_URL,
  DEFAULT_LRCLIB_REFRESH_MS,
  LRCLIB_MISS_TTL_SECONDS,
  LRCLIB_SUCCESS_TTL_SECONDS,
  LrclibProviderError,
  buildLrclibGetUrl,
  buildLrclibSearchUrl,
  fetchLrclibLyrics,
  getLrclibConfig,
  isLrclibRowFresh,
  normalizeLyricsIdentity,
  normalizeLrclibLyrics,
  parseLrcToSegments,
  resolveLrclibLyrics,
} from "./lrclib.js";
import { resolveMediaLyrics } from "./routes/lyrics.js";

describe("normalizeWhisperLyrics", () => {
  it("keeps line timing and drops Whisper diagnostic data", () => {
    const result = normalizeWhisperLyrics({
      text: "Ignored full text",
      language: " en ",
      segments: [
        {
          id: 1,
          seek: 100,
          start: 4.5,
          end: 7.25,
          text: " Second line ",
          tokens: [1, 2],
          temperature: 0,
          words: [{ word: "Second", start: 4.5, end: 5.2, probability: 0.9 }],
        },
        { id: 0, start: 1, end: 3, text: " First line " },
      ],
    });

    expect(result).toEqual({
      language: "en",
      segments: [
        { start: 1, end: 3, text: "First line" },
        { start: 4.5, end: 7.25, text: "Second line" },
      ],
    });
  });

  it("discards blank segments", () => {
    expect(normalizeWhisperLyrics({
      segments: [
        { start: 0, end: 1, text: "   " },
        { start: 1, end: 2, text: "Keep me" },
      ],
    }).segments).toEqual([{ start: 1, end: 2, text: "Keep me" }]);
  });

  it.each([
    null,
    {},
    { segments: [{ start: -1, end: 2, text: "Invalid" }] },
    { segments: [{ start: 2, end: 1, text: "Invalid" }] },
    { segments: [{ start: 0, end: 1, text: "" }] },
  ])("rejects malformed lyrics %#", (payload) => {
    expect(() => normalizeWhisperLyrics(payload)).toThrow(LyricsValidationError);
  });
});

describe("upsertUploadedLyrics", () => {
  it("marks uploads as authoritative and clears provider lookup metadata", async () => {
    const calls = [];
    const pg = {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [{ media_id: 7, language: "en", segments: [{ start: 0, end: 1, text: "Line" }] }] };
      },
    };

    await upsertUploadedLyrics(pg, 7, { language: "en", segments: [{ start: 0, end: 1, text: "Line" }] });

    expect(calls[0].sql).toContain("'uploaded'");
    expect(calls[0].sql).toContain("lookup_title = NULL");
    expect(calls[0].sql).toContain("lookup_artists = NULL");
  });
});

function createRedis(cachedValue) {
  return {
    getCalls: [],
    setCalls: [],
    async get(key) {
      this.getCalls.push(key);
      return cachedValue;
    },
    async set(...args) {
      this.setCalls.push(args);
    },
  };
}

describe("normalizeLrclibLyrics", () => {
  it("converts standard LRC format to sorted second-based segments", () => {
    const lrc = "[00:01.00] First line\n[00:04.50] Second line";
    expect(normalizeLrclibLyrics({ syncedLyrics: lrc, language: " en " })).toEqual({
      language: "en",
      segments: [
        { start: 1, end: 4.5, text: "First line" },
        { start: 4.5, end: 9.5, text: "Second line" },
      ],
    });
  });

  it("handles legacy timed_lyrics payload for compatibility", () => {
    expect(normalizeLrclibLyrics({
      status: "success",
      data: {
        hasTimestamps: true,
        timed_lyrics: [
          { text: " Second line ", start_time: 4500, end_time: 7250 },
          { text: "First line", start_time: 1000, end_time: 3000 },
        ],
        language: " en ",
      },
    })).toEqual({
      language: "en",
      segments: [
        { start: 1, end: 3, text: "First line" },
        { start: 4.5, end: 7.25, text: "Second line" },
      ],
    });
  });

  it("rejects malformed payloads", () => {
    expect(() => normalizeLrclibLyrics({ status: "error" })).toThrow(LrclibProviderError);
    expect(() => normalizeLrclibLyrics(null)).toThrow(LrclibProviderError);
  });
});

describe("LRCLIB requests", () => {
  it("builds an encoded timestamped request and bounds configuration", () => {
    const url = buildLrclibGetUrl("https://lrclib.net", "Artist & Guest", "A/B Song", 180);
    expect(url.origin).toBe("https://lrclib.net");
    expect(url.pathname).toBe("/api/get");
    expect(url.searchParams.get("artist_name")).toBe("Artist & Guest");
    expect(url.searchParams.get("track_name")).toBe("A/B Song");
    expect(url.searchParams.get("duration")).toBe("180");
    expect(getLrclibConfig({ LRCLIB_TIMEOUT_MS: "999999" }).timeoutMs).toBe(15000);
    expect(normalizeLyricsIdentity(" Artist  ")).toBe("artist");
  });

  it("treats a provider 404 as a confirmed miss", async () => {
    const lyrics = await fetchLrclibLyrics({
      apiUrl: "https://lrclib.net",
      artist: "Artist",
      song: "Song",
      timeoutMs: 5000,
      fetchImpl: async () => new Response(null, { status: 404 }),
    });
    expect(lyrics).toBeNull();
  });

  it("classifies rate limits, timeouts, invalid JSON, and upstream errors", async () => {
    const request = { apiUrl: "https://lrclib.net", artist: "Artist", song: "Song", timeoutMs: 5000 };

    await expect(fetchLrclibLyrics({
      ...request,
      fetchImpl: async () => new Response(null, { status: 429, headers: { "retry-after": "12" } }),
    })).rejects.toMatchObject({ kind: "rate-limit", retryAfter: 12 });
    await expect(fetchLrclibLyrics({
      ...request,
      fetchImpl: async () => { throw Object.assign(new Error("late"), { name: "TimeoutError" }); },
    })).rejects.toMatchObject({ kind: "timeout" });
    await expect(fetchLrclibLyrics({
      ...request,
      fetchImpl: async () => new Response("not-json", { status: 200 }),
    })).rejects.toMatchObject({ kind: "malformed" });
    await expect(fetchLrclibLyrics({
      ...request,
      fetchImpl: async () => new Response(null, { status: 500 }),
    })).rejects.toMatchObject({ kind: "upstream" });
  });
});

describe("isLrclibRowFresh", () => {
  it("considers rows updated within the refresh window as fresh", () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    expect(isLrclibRowFresh({ updated_at: recent })).toBe(true);
    expect(isLrclibRowFresh({ updated_at: new Date(Date.now() - 1000) })).toBe(true);
  });

  it("considers rows older than refresh window or missing updated_at as stale", () => {
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isLrclibRowFresh({ updated_at: stale })).toBe(false);
    expect(isLrclibRowFresh({ updated_at: null })).toBe(false);
    expect(isLrclibRowFresh({ updated_at: "invalid" })).toBe(false);
    expect(isLrclibRowFresh(null)).toBe(false);
  });

  it("supports custom refresh intervals", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(isLrclibRowFresh({ updated_at: threeDaysAgo }, 2 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(isLrclibRowFresh({ updated_at: threeDaysAgo }, 5 * 24 * 60 * 60 * 1000)).toBe(true);
  });
});

describe("resolveLrclibLyrics", () => {
  const config = { apiUrl: "https://lrclib.net", timeoutMs: 5000 };

  it("caches successful normalized lyrics for 24 hours", async () => {
    const redis = createRedis(null);
    const fetchImpl = async () => new Response(JSON.stringify({
      id: 1,
      trackName: "Song",
      artistName: "Artist",
      syncedLyrics: "[00:00.00] Line\n[00:01.00]",
    }), { status: 200, headers: { "content-type": "application/json" } });

    const lyrics = await resolveLrclibLyrics({ artist: "Artist", song: "Song", redis, fetchImpl, config });

    expect(lyrics?.segments).toEqual([{ start: 0, end: 1, text: "Line" }]);
    expect(redis.setCalls[0].slice(2)).toEqual(["EX", LRCLIB_SUCCESS_TTL_SECONDS]);
  });

  it("uses cached lyrics without fetching and briefly caches confirmed misses", async () => {
    const cachedLyrics = { language: null, segments: [{ start: 0, end: 1, text: "Cached" }] };
    const cachedRedis = createRedis(JSON.stringify(cachedLyrics));
    const unavailableFetch = async () => { throw new Error("should not fetch"); };
    await expect(resolveLrclibLyrics({
      artist: "Artist", song: "Song", redis: cachedRedis, fetchImpl: unavailableFetch, config,
    })).resolves.toEqual(cachedLyrics);

    const missRedis = createRedis(null);
    await expect(resolveLrclibLyrics({
      artist: "Artist",
      song: "Missing",
      redis: missRedis,
      fetchImpl: async () => new Response(null, { status: 404 }),
      config,
    })).resolves.toBeNull();
    expect(missRedis.setCalls[0].slice(2)).toEqual(["EX", LRCLIB_MISS_TTL_SECONDS]);
  });

  it("does not cache transient provider failures", async () => {
    const redis = createRedis(null);
    await expect(resolveLrclibLyrics({
      artist: "Artist",
      song: "Song",
      redis,
      fetchImpl: async () => new Response(null, { status: 500 }),
      config,
    })).rejects.toBeInstanceOf(LrclibProviderError);
    expect(redis.setCalls).toEqual([]);
  });
});

describe("resolveMediaLyrics", () => {
  const recentUpdatedAt = new Date().toISOString();
  const uploadedRow = {
    media_id: 7,
    title: "Song",
    artists: "Artist",
    mime_type: "audio/mpeg",
    language: "en",
    segments: [{ start: 0, end: 1, text: "Uploaded" }],
    updated_at: recentUpdatedAt,
  };

  it("returns uploaded lyrics without consulting LRCLIB even if older than refresh interval", async () => {
    const staleUploadedRow = {
      ...uploadedRow,
      updated_at: "2020-01-01T00:00:00.000Z",
    };
    await expect(resolveMediaLyrics(staleUploadedRow)).resolves.toEqual({
      mediaId: 7,
      language: "en",
      segments: uploadedRow.segments,
      updatedAt: staleUploadedRow.updated_at,
    });
  });

  it.each([
    { mime_type: "video/mp4", title: "Song", artists: "Artist" },
    { mime_type: "audio/mpeg", title: "", artists: "Artist" },
    { mime_type: "audio/mpeg", title: "Song", artists: null },
  ])("does not query LRCLIB for ineligible media %#", async (metadata) => {
    await expect(resolveMediaLyrics({ media_id: 7, segments: null, ...metadata })).resolves.toBeNull();
  });

  it("reuses stored LRCLIB lyrics when lookup metadata still matches", async () => {
    const row = {
      ...uploadedRow,
      lyrics_source: "lrclib",
      lookup_title: " song ",
      lookup_artists: "ARTIST",
    };
    await expect(resolveMediaLyrics(row)).resolves.toEqual({
      mediaId: 7,
      language: "en",
      segments: row.segments,
      updatedAt: row.updated_at,
    });
  });

  it("persists a first successful LRCLIB lookup before returning it", async () => {
    const redis = createRedis(null);
    const persistedAt = "2026-08-05T08:00:00.000Z";
    const pgCalls = [];
    const pg = {
      async query(sql, params) {
        pgCalls.push({ sql, params });
        return {
          rows: [{
            media_id: 7,
            language: null,
            segments: [{ start: 1, end: 2, text: "Fetched" }],
            updated_at: persistedAt,
          }],
        };
      },
    };

    const result = await resolveMediaLyrics({
      media_id: 7,
      title: "Song",
      artists: "Artist",
      mime_type: "audio/mpeg",
      segments: null,
    }, {
      pg,
      redis,
      config: { apiUrl: "https://lrclib.net", timeoutMs: 5000 },
      fetchImpl: async () => new Response(JSON.stringify({
        id: 1,
        trackName: "Song",
        artistName: "Artist",
        syncedLyrics: "[00:01.00] Fetched\n[00:02.00] End",
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });

    expect(result).toEqual({
      mediaId: 7,
      language: null,
      segments: [{ start: 1, end: 2, text: "Fetched" }],
      updatedAt: persistedAt,
    });
    expect(pgCalls[0].sql).toContain("WHERE media_lyrics.source = 'lrclib'");
    expect(pgCalls[0].params.slice(3)).toEqual(["Song", "Artist"]);
  });

  it("persists a Redis-cached result and refreshes stale metadata", async () => {
    const cached = { language: null, segments: [{ start: 2, end: 3, text: "Cached" }] };
    const redis = createRedis(JSON.stringify(cached));
    const pgCalls = [];
    const pg = {
      async query(sql, params) {
        pgCalls.push({ sql, params });
        return { rows: [{ media_id: 7, ...cached, updated_at: "saved" }] };
      },
    };

    await resolveMediaLyrics({
      ...uploadedRow,
      title: "New Song",
      segments: [{ start: 0, end: 1, text: "Stale" }],
      lyrics_source: "lrclib",
      lookup_title: "Old Song",
      lookup_artists: "Artist",
    }, { pg, redis });

    expect(redis.getCalls).toHaveLength(1);
    expect(pgCalls[0].params.slice(3)).toEqual(["New Song", "Artist"]);
  });

  it("removes only a stale generated row after a confirmed miss", async () => {
    const pgCalls = [];
    const pg = {
      async query(sql, params) {
        pgCalls.push({ sql, params });
        return { rows: [], rowCount: 1 };
      },
    };

    await expect(resolveMediaLyrics({
      ...uploadedRow,
      title: "Renamed",
      lyrics_source: "lrclib",
      lookup_title: "Old title",
      lookup_artists: "Artist",
    }, {
      pg,
      redis: createRedis(null),
      config: { apiUrl: "https://lrclib.net", timeoutMs: 5000 },
      fetchImpl: async () => new Response(null, { status: 404 }),
    })).resolves.toBeNull();

    expect(pgCalls).toHaveLength(1);
    expect(pgCalls[0].sql).toContain("source = 'lrclib'");
  });

  it("returns a concurrently uploaded row instead of overwriting it", async () => {
    const pg = {
      calls: 0,
      async query() {
        this.calls += 1;
        if (this.calls === 1) return { rows: [] };
        return {
          rows: [{
            media_id: 7,
            language: "en",
            segments: [{ start: 0, end: 1, text: "Uploaded during fetch" }],
            updated_at: "uploaded-at",
          }],
        };
      },
    };

    const result = await resolveMediaLyrics({
      media_id: 7, title: "Song", artists: "Artist", mime_type: "audio/mpeg", segments: null,
    }, {
      pg,
      redis: createRedis(JSON.stringify({
        language: null,
        segments: [{ start: 2, end: 3, text: "Generated" }],
      })),
    });

    expect(result.segments[0].text).toBe("Uploaded during fetch");
    expect(pg.calls).toBe(2);
  });

  it("does not delete stale lyrics after a transient provider failure", async () => {
    const pg = { query: async () => { throw new Error("should not write"); } };
    await expect(resolveMediaLyrics({
      ...uploadedRow,
      title: "Renamed",
      lyrics_source: "lrclib",
      lookup_title: "Old title",
      lookup_artists: "Artist",
    }, {
      pg,
      redis: createRedis(null),
      config: { apiUrl: "https://lrclib.net", timeoutMs: 5000 },
      fetchImpl: async () => new Response(null, { status: 500 }),
    })).rejects.toBeInstanceOf(LrclibProviderError);
  });

  it("refreshes stale LRCLIB lyrics and updates the database", async () => {
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const newPersistedAt = new Date().toISOString();
    const pgCalls = [];
    const pg = {
      async query(sql, params) {
        pgCalls.push({ sql, params });
        return {
          rows: [{
            media_id: 7,
            language: null,
            segments: [{ start: 0, end: 2, text: "Better lyrics from provider" }],
            updated_at: newPersistedAt,
          }],
        };
      },
    };
    const redis = createRedis(null);
    const result = await resolveMediaLyrics({
      ...uploadedRow,
      lyrics_source: "lrclib",
      lookup_title: "Song",
      lookup_artists: "Artist",
      updated_at: staleDate,
    }, {
      pg,
      redis,
      config: { apiUrl: "https://lrclib.net", timeoutMs: 5000, refreshMs: DEFAULT_LRCLIB_REFRESH_MS },
      fetchImpl: async () => new Response(JSON.stringify({
        id: 1,
        trackName: "Song",
        artistName: "Artist",
        syncedLyrics: "[00:00.00] Better lyrics from provider\n[00:02.00] End",
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });

    expect(result).toEqual({
      mediaId: 7,
      language: null,
      segments: [{ start: 0, end: 2, text: "Better lyrics from provider" }],
      updatedAt: newPersistedAt,
    });
    expect(pgCalls[0].sql).toContain("INSERT INTO media_lyrics");
    expect(pgCalls[0].sql).toContain("updated_at = NOW()");
  });

  it("gracefully retains existing lyrics when periodic refresh encounters provider error", async () => {
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const pg = {
      async query() {
        throw new Error("should not run update query on provider error");
      },
    };
    const redis = createRedis(null);
    const result = await resolveMediaLyrics({
      ...uploadedRow,
      lyrics_source: "lrclib",
      lookup_title: "Song",
      lookup_artists: "Artist",
      updated_at: staleDate,
    }, {
      pg,
      redis,
      config: { apiUrl: "https://lrclib.net", timeoutMs: 5000, refreshMs: DEFAULT_LRCLIB_REFRESH_MS },
      fetchImpl: async () => new Response(null, { status: 500 }),
    });

    expect(result).toEqual({
      mediaId: 7,
      language: "en",
      segments: uploadedRow.segments,
      updatedAt: staleDate,
    });
  });

  it("retains existing lyrics and touches updated_at when periodic refresh returns 404", async () => {
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const pgCalls = [];
    const pg = {
      async query(sql, params) {
        pgCalls.push({ sql, params });
        return { rowCount: 1 };
      },
    };
    const redis = createRedis(null);
    const result = await resolveMediaLyrics({
      ...uploadedRow,
      lyrics_source: "lrclib",
      lookup_title: "Song",
      lookup_artists: "Artist",
      updated_at: staleDate,
    }, {
      pg,
      redis,
      config: { apiUrl: "https://lrclib.net", timeoutMs: 5000, refreshMs: DEFAULT_LRCLIB_REFRESH_MS },
      fetchImpl: async () => new Response(null, { status: 404 }),
    });

    expect(result).toEqual({
      mediaId: 7,
      language: "en",
      segments: uploadedRow.segments,
      updatedAt: staleDate,
    });
    expect(pgCalls).toHaveLength(1);
    expect(pgCalls[0].sql).toContain("UPDATE media_lyrics SET updated_at = NOW() WHERE media_id = $1 AND source = 'lrclib'");
    expect(pgCalls[0].sql).not.toContain("DELETE");
  });
});

describe("LRCLIB Synced Lyrics Integration", () => {
  it("parses standard LRC format with [mm:ss.xx] timestamps into sequential segments", () => {
    const lrc = `
[ti:Numb]
[ar:Linkin Park]
[00:00.00]
[00:21.58]I'm tired of being what you want me to be
[00:25.62]Feeling so faithless, lost under the surface
[00:30.61]Don't know what you're expecting of me
[00:34.09]Put under the pressure of walking in your shoes
[01:00.00]Final line
    `;

    const segments = parseLrcToSegments(lrc, 70);
    expect(segments).toHaveLength(5);
    expect(segments[0]).toEqual({
      start: 21.58,
      end: 25.62,
      text: "I'm tired of being what you want me to be",
    });
    expect(segments[1]).toEqual({
      start: 25.62,
      end: 30.61,
      text: "Feeling so faithless, lost under the surface",
    });
    expect(segments[4]).toEqual({
      start: 60,
      end: 68,
      text: "Final line",
    });
  });

  it("handles repeated timestamps and uses a later blank line as a timing boundary", () => {
    const lrc = `
[al:Album Name]
[00:10.00][00:20.00]Repeated chorus
[00:30.00]
    `;
    const segments = parseLrcToSegments(lrc);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ start: 10, end: 20, text: "Repeated chorus" });
    expect(segments[1]).toEqual({ start: 20, end: 30, text: "Repeated chorus" });
  });

  it("uses empty timestamped lines to end vocals without returning empty lyrics", () => {
    const lrc = `
[00:15.75]Make up your mind
[00:19.73]
[00:23.64]
[00:27.00]Next lyric
    `;

    expect(parseLrcToSegments(lrc)).toEqual([
      { start: 15.75, end: 19.73, text: "Make up your mind" },
      { start: 27, end: 32, text: "Next lyric" },
    ]);
  });

  it("builds correct LRCLIB get and search URLs", () => {
    const getUrl = buildLrclibGetUrl(DEFAULT_LRCLIB_API_URL, "Linkin Park", "Numb", 186.4);
    expect(getUrl.origin).toBe("https://lrclib.net");
    expect(getUrl.pathname).toBe("/api/get");
    expect(getUrl.searchParams.get("artist_name")).toBe("Linkin Park");
    expect(getUrl.searchParams.get("track_name")).toBe("Numb");
    expect(getUrl.searchParams.get("duration")).toBe("186");

    const searchUrl = buildLrclibSearchUrl(DEFAULT_LRCLIB_API_URL, "Linkin Park", "Numb");
    expect(searchUrl.pathname).toBe("/api/search");
    expect(searchUrl.searchParams.get("track_name")).toBe("Numb");
    expect(searchUrl.searchParams.get("artist_name")).toBe("Linkin Park");
  });

  it("normalizes LRCLIB syncedLyrics response into valid Whisper-style segments", () => {
    const payload = {
      id: 14348,
      trackName: "Numb",
      artistName: "Linkin Park",
      duration: 186,
      syncedLyrics: "[00:21.58] I'm tired\n[00:25.62] Feeling faithless",
    };

    const result = normalizeLrclibLyrics(payload);
    expect(result).toEqual({
      language: null,
      segments: [
        { start: 21.58, end: 25.62, text: "I'm tired" },
        { start: 25.62, end: 33.62, text: "Feeling faithless" },
      ],
    });
  });

  it("falls back to search endpoint when direct LRCLIB get returns 404", async () => {
    let searchCalled = false;
    const fetchImpl = async (url) => {
      const u = new URL(url);
      if (u.pathname === "/api/get") {
        return new Response(null, { status: 404 });
      }
      if (u.pathname === "/api/search") {
        searchCalled = true;
        return new Response(JSON.stringify([
          {
            trackName: "Numb",
            artistName: "Linkin Park",
            syncedLyrics: "[00:21.58] Fallback search line",
          },
        ]), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, { status: 404 });
    };

    const lyrics = await fetchLrclibLyrics({
      apiUrl: DEFAULT_LRCLIB_API_URL,
      artist: "Linkin Park",
      song: "Numb",
      fetchImpl,
      timeoutMs: 5000,
    });

    expect(searchCalled).toBe(true);
    expect(lyrics?.segments).toEqual([
      { start: 21.58, end: 26.58, text: "Fallback search line" },
    ]);
  });
});
