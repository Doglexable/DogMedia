import { describe, expect, it } from "vitest";
import { LyricsValidationError, normalizeWhisperLyrics, upsertUploadedLyrics } from "./lyrics.js";
import {
  LYRICA_MISS_TTL_SECONDS,
  LYRICA_SUCCESS_TTL_SECONDS,
  LyricaProviderError,
  buildLyricaUrl,
  fetchLyricaLyrics,
  getLyricaConfig,
  normalizeLyricsIdentity,
  normalizeLyricaLyrics,
  resolveLyricaLyrics,
} from "./lyrica.js";
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

function lyricaPayload(lines, overrides = {}) {
  return {
    status: "success",
    data: {
      hasTimestamps: true,
      timed_lyrics: lines,
      ...overrides,
    },
  };
}

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

describe("normalizeLyricaLyrics", () => {
  it("converts milliseconds to sorted second-based segments", () => {
    expect(normalizeLyricaLyrics(lyricaPayload([
      { text: " Second line ", start_time: 4500, end_time: 7250 },
      { text: "First line", start_time: 1000, end_time: 3000 },
    ], { language: " en " }))).toEqual({
      language: "en",
      segments: [
        { start: 1, end: 3, text: "First line" },
        { start: 4.5, end: 7.25, text: "Second line" },
      ],
    });
  });

  it("drops blank and malformed timed lines", () => {
    expect(normalizeLyricaLyrics(lyricaPayload([
      { text: "", start_time: 0, end_time: 1000 },
      { text: "Backwards", start_time: 2000, end_time: 1000 },
      { text: "Keep", start_time: 3000, end_time: 4000 },
    ]))?.segments).toEqual([{ start: 3, end: 4, text: "Keep" }]);
  });

  it("requires line timestamps and rejects malformed envelopes", () => {
    expect(normalizeLyricaLyrics(lyricaPayload([], { hasTimestamps: false }))).toBeNull();
    expect(normalizeLyricaLyrics(lyricaPayload([], { timed_lyrics: undefined }))).toBeNull();
    expect(() => normalizeLyricaLyrics(lyricaPayload([
      { text: "Invalid", start_time: 2000, end_time: 1000 },
    ]))).toThrow(LyricaProviderError);
    expect(() => normalizeLyricaLyrics({ status: "error" })).toThrow(LyricaProviderError);
  });
});

describe("Lyrica requests", () => {
  it("builds an encoded timestamped request and bounds configuration", () => {
    const url = buildLyricaUrl("https://lyrics.example/", "Artist & Guest", "A/B Song");
    expect(url.origin).toBe("https://lyrics.example");
    expect(url.pathname).toBe("/lyrics/");
    expect(url.searchParams.get("artist")).toBe("Artist & Guest");
    expect(url.searchParams.get("song")).toBe("A/B Song");
    expect(url.searchParams.get("timestamps")).toBe("true");
    expect(getLyricaConfig({ LYRICA_TIMEOUT_MS: "999999" }).timeoutMs).toBe(15000);
    expect(normalizeLyricsIdentity(" Artist  ")).toBe("artist");
  });

  it("treats a provider 404 as a confirmed miss", async () => {
    const lyrics = await fetchLyricaLyrics({
      apiUrl: "https://lyrics.example",
      artist: "Artist",
      song: "Song",
      timeoutMs: 5000,
      fetchImpl: async () => new Response(null, { status: 404 }),
    });
    expect(lyrics).toBeNull();
  });

  it("classifies rate limits, timeouts, invalid JSON, and upstream errors", async () => {
    const request = { apiUrl: "https://lyrics.example", artist: "Artist", song: "Song", timeoutMs: 5000 };

    await expect(fetchLyricaLyrics({
      ...request,
      fetchImpl: async () => new Response(null, { status: 429, headers: { "retry-after": "12" } }),
    })).rejects.toMatchObject({ kind: "rate-limit", retryAfter: 12 });
    await expect(fetchLyricaLyrics({
      ...request,
      fetchImpl: async () => { throw Object.assign(new Error("late"), { name: "TimeoutError" }); },
    })).rejects.toMatchObject({ kind: "timeout" });
    await expect(fetchLyricaLyrics({
      ...request,
      fetchImpl: async () => new Response("not-json", { status: 200 }),
    })).rejects.toMatchObject({ kind: "malformed" });
    await expect(fetchLyricaLyrics({
      ...request,
      fetchImpl: async () => new Response(null, { status: 500 }),
    })).rejects.toMatchObject({ kind: "upstream" });
  });
});

describe("resolveLyricaLyrics", () => {
  const config = { apiUrl: "https://lyrics.example", timeoutMs: 5000 };

  it("caches successful normalized lyrics for 24 hours", async () => {
    const redis = createRedis(null);
    const fetchImpl = async () => new Response(JSON.stringify(lyricaPayload([
      { text: "Line", start_time: 0, end_time: 1000 },
    ])), { status: 200 });

    const lyrics = await resolveLyricaLyrics({ artist: "Artist", song: "Song", redis, fetchImpl, config });

    expect(lyrics?.segments).toEqual([{ start: 0, end: 1, text: "Line" }]);
    expect(redis.setCalls[0].slice(2)).toEqual(["EX", LYRICA_SUCCESS_TTL_SECONDS]);
  });

  it("uses cached lyrics without fetching and briefly caches confirmed misses", async () => {
    const cachedLyrics = { language: null, segments: [{ start: 0, end: 1, text: "Cached" }] };
    const cachedRedis = createRedis(JSON.stringify(cachedLyrics));
    const unavailableFetch = async () => { throw new Error("should not fetch"); };
    await expect(resolveLyricaLyrics({
      artist: "Artist", song: "Song", redis: cachedRedis, fetchImpl: unavailableFetch, config,
    })).resolves.toEqual(cachedLyrics);

    const missRedis = createRedis(null);
    await expect(resolveLyricaLyrics({
      artist: "Artist",
      song: "Missing",
      redis: missRedis,
      fetchImpl: async () => new Response(null, { status: 404 }),
      config,
    })).resolves.toBeNull();
    expect(missRedis.setCalls[0].slice(2)).toEqual(["EX", LYRICA_MISS_TTL_SECONDS]);
  });

  it("does not cache transient provider failures", async () => {
    const redis = createRedis(null);
    await expect(resolveLyricaLyrics({
      artist: "Artist",
      song: "Song",
      redis,
      fetchImpl: async () => new Response(null, { status: 500 }),
      config,
    })).rejects.toBeInstanceOf(LyricaProviderError);
    expect(redis.setCalls).toEqual([]);
  });
});

describe("resolveMediaLyrics", () => {
  const uploadedRow = {
    media_id: 7,
    title: "Song",
    artists: "Artist",
    mime_type: "audio/mpeg",
    language: "en",
    segments: [{ start: 0, end: 1, text: "Uploaded" }],
    updated_at: "2026-08-05T00:00:00.000Z",
  };

  it("returns uploaded lyrics without consulting Lyrica", async () => {
    await expect(resolveMediaLyrics(uploadedRow)).resolves.toEqual({
      mediaId: 7,
      language: "en",
      segments: uploadedRow.segments,
      updatedAt: uploadedRow.updated_at,
    });
  });

  it.each([
    { mime_type: "video/mp4", title: "Song", artists: "Artist" },
    { mime_type: "audio/mpeg", title: "", artists: "Artist" },
    { mime_type: "audio/mpeg", title: "Song", artists: null },
  ])("does not query Lyrica for ineligible media %#", async (metadata) => {
    await expect(resolveMediaLyrics({ media_id: 7, segments: null, ...metadata })).resolves.toBeNull();
  });

  it("reuses stored Lyrica lyrics when lookup metadata still matches", async () => {
    const row = {
      ...uploadedRow,
      lyrics_source: "lyrica",
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

  it("persists a first successful Lyrica lookup before returning it", async () => {
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
      config: { apiUrl: "https://lyrics.example", timeoutMs: 5000 },
      fetchImpl: async () => new Response(JSON.stringify(lyricaPayload([
        { text: "Fetched", start_time: 1000, end_time: 2000 },
      ])), { status: 200 }),
    });

    expect(result).toEqual({
      mediaId: 7,
      language: null,
      segments: [{ start: 1, end: 2, text: "Fetched" }],
      updatedAt: persistedAt,
    });
    expect(pgCalls[0].sql).toContain("WHERE media_lyrics.source = 'lyrica'");
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
      lyrics_source: "lyrica",
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
      lyrics_source: "lyrica",
      lookup_title: "Old title",
      lookup_artists: "Artist",
    }, {
      pg,
      redis: createRedis(null),
      config: { apiUrl: "https://lyrics.example", timeoutMs: 5000 },
      fetchImpl: async () => new Response(null, { status: 404 }),
    })).resolves.toBeNull();

    expect(pgCalls).toHaveLength(1);
    expect(pgCalls[0].sql).toContain("source = 'lyrica'");
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
      lyrics_source: "lyrica",
      lookup_title: "Old title",
      lookup_artists: "Artist",
    }, {
      pg,
      redis: createRedis(null),
      config: { apiUrl: "https://lyrics.example", timeoutMs: 5000 },
      fetchImpl: async () => new Response(null, { status: 500 }),
    })).rejects.toBeInstanceOf(LyricaProviderError);
  });
});
