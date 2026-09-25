import { createHash } from "node:crypto";

import { LyricsValidationError, normalizeWhisperLyrics } from "./lyrics.js";

export const LRCLIB_SUCCESS_TTL_SECONDS = 24 * 60 * 60;
export const LRCLIB_MISS_TTL_SECONDS = 15 * 60;
export const DEFAULT_LRCLIB_REFRESH_DAYS = 7;
export const DEFAULT_LRCLIB_REFRESH_MS = DEFAULT_LRCLIB_REFRESH_DAYS * 24 * 60 * 60 * 1000;

export const DEFAULT_LRCLIB_API_URL = "https://lrclib.net";
export const DEFAULT_LRCLIB_USER_AGENT = "PFS-MusicPlayer/1.0 (https://github.com/mann/private-file-stream)";
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 15000;

export class LrclibProviderError extends Error {
  constructor(message, { kind = "upstream", retryAfter = null } = {}) {
    super(message);
    this.name = "LrclibProviderError";
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

export function getLrclibConfig(env = process.env) {
  const parsedTimeout = Number.parseInt(env.LRCLIB_TIMEOUT_MS || env.LYRICA_TIMEOUT_MS, 10);
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.min(Math.max(parsedTimeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;

  const parsedRefreshDays = Number.parseFloat(env.LRCLIB_REFRESH_DAYS || env.LYRICA_REFRESH_DAYS);
  const refreshMs = Number.isFinite(parsedRefreshDays) && parsedRefreshDays > 0
    ? parsedRefreshDays * 24 * 60 * 60 * 1000
    : DEFAULT_LRCLIB_REFRESH_MS;

  return {
    apiUrl: env.LRCLIB_API_URL?.trim() || env.LYRICA_API_URL?.trim() || DEFAULT_LRCLIB_API_URL,
    timeoutMs,
    refreshMs,
    userAgent: env.LRCLIB_USER_AGENT?.trim() || DEFAULT_LRCLIB_USER_AGENT,
  };
}

export function isLrclibRowFresh(row, refreshMs = DEFAULT_LRCLIB_REFRESH_MS) {
  if (!row?.updated_at) return false;
  const updatedTime = row.updated_at instanceof Date
    ? row.updated_at.getTime()
    : new Date(row.updated_at).getTime();
  if (!Number.isFinite(updatedTime)) return false;
  return Date.now() - updatedTime < refreshMs;
}

export function buildLrclibGetUrl(apiUrl, artist, song, duration) {
  const url = new URL(`${apiUrl.replace(/\/+$/, "")}/api/get`);
  url.searchParams.set("artist_name", artist);
  url.searchParams.set("track_name", song);
  if (Number.isFinite(duration) && duration > 0) {
    url.searchParams.set("duration", String(Math.round(duration)));
  }
  return url;
}

export function buildLrclibSearchUrl(apiUrl, artist, song) {
  const url = new URL(`${apiUrl.replace(/\/+$/, "")}/api/search`);
  url.searchParams.set("track_name", song);
  url.searchParams.set("artist_name", artist);
  return url;
}

export function buildLyricaUrl(apiUrl, artist, song) {
  const url = new URL(`${apiUrl.replace(/\/+$/, "")}/lyrics/`);
  url.searchParams.set("artist", artist);
  url.searchParams.set("song", song);
  url.searchParams.set("timestamps", "true");
  return url;
}

/**
 * Parses standard LRC timestamped text lines into { start, end, text } segments.
 */
export function parseLrcToSegments(lrcString, totalDuration = null) {
  if (typeof lrcString !== "string" || !lrcString.trim()) {
    return [];
  }

  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  // Keep empty timestamped lines as timing cues. They are not returned as
  // lyrics, but they mark the point where the preceding vocal line ends.
  const rawCues = [];

  for (const line of lrcString.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    timeRegex.lastIndex = 0;
    const matches = [];
    let match;
    while ((match = timeRegex.exec(trimmed)) !== null) {
      matches.push(match);
    }
    if (matches.length === 0) continue;

    const lastMatch = matches[matches.length - 1];
    const text = trimmed.slice(lastMatch.index + lastMatch[0].length).trim();

    for (const m of matches) {
      const mins = Number.parseInt(m[1], 10);
      const secs = Number.parseInt(m[2], 10);
      const frac = m[3] ? Number.parseFloat(`0.${m[3]}`) : 0;
      const start = Number((mins * 60 + secs + frac).toFixed(3));
      rawCues.push({ start, text });
    }
  }

  if (!rawCues.some((cue) => cue.text)) return [];
  rawCues.sort((a, b) => a.start - b.start);

  const segments = [];
  for (let i = 0; i < rawCues.length; i++) {
    const { start, text } = rawCues[i];
    if (!text) continue;

    let end;
    const nextCue = rawCues.slice(i + 1).find((cue) => cue.start > start);
    if (nextCue) {
      const nextStart = nextCue.start;
      end = Math.min(nextStart, Number((start + 12).toFixed(3)));
    } else {
      end = Number((start + 5).toFixed(3));
      const dur = Number(totalDuration);
      if (Number.isFinite(dur) && dur > start) {
        end = Math.min(Number(dur.toFixed(3)), Number((start + 8).toFixed(3)));
      }
    }
    segments.push({ start, end, text });
  }

  return segments;
}

export function normalizeLrclibLyrics(payload, totalDuration = null) {
  if (!payload || typeof payload !== "object") {
    throw new LrclibProviderError("LRCLIB returned an invalid response", { kind: "malformed" });
  }

  if (payload.status === "error") {
    throw new LrclibProviderError("Provider returned error status", { kind: "malformed" });
  }

  // 1. LRCLIB standard format: { syncedLyrics: "..." }
  if (typeof payload.syncedLyrics === "string") {
    if (!payload.syncedLyrics.trim()) return null;
    const duration = Number(totalDuration) || Number(payload.duration) || null;
    const segments = parseLrcToSegments(payload.syncedLyrics, duration);
    if (segments.length === 0) return null;
    try {
      return normalizeWhisperLyrics({
        language: typeof payload.language === "string" ? payload.language.trim() : "",
        segments,
      });
    } catch (error) {
      if (error instanceof LyricsValidationError) {
        throw new LrclibProviderError("LRCLIB returned invalid timed lyrics", { kind: "malformed" });
      }
      throw error;
    }
  }

  // 2. Timed lyrics envelope format: { data: { hasTimestamps: true, timed_lyrics: [...] } }
  if (payload.data && typeof payload.data === "object") {
    if (payload.data.hasTimestamps !== true || !Array.isArray(payload.data.timed_lyrics)) {
      return null;
    }
    const segments = payload.data.timed_lyrics.flatMap((line) => {
      if (!line || typeof line !== "object") return [];
      const start = Number(line.start_time) / 1000;
      const end = Number(line.end_time) / 1000;
      const text = typeof line.text === "string" ? line.text.trim() : "";
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return [];
      return [{ start, end, text }];
    });

    if (segments.length === 0) {
      if (payload.data.timed_lyrics.length === 0) return null;
      throw new LrclibProviderError("Provider returned invalid timed lyrics", { kind: "malformed" });
    }

    try {
      return normalizeWhisperLyrics({
        language: typeof payload.data.language === "string" ? payload.data.language.trim() : "",
        segments,
      });
    } catch (error) {
      if (error instanceof LyricsValidationError) {
        throw new LrclibProviderError("Provider returned invalid timed lyrics", { kind: "malformed" });
      }
      throw error;
    }
  }

  if ("syncedLyrics" in payload && (payload.syncedLyrics == null || payload.syncedLyrics === "")) {
    return null;
  }

  throw new LrclibProviderError("Provider returned an invalid response", { kind: "malformed" });
}

function parseRetryAfter(value) {
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function getProviderRequestUrl(apiUrl, artist, song, duration) {
  if (apiUrl.includes("/lyrics")) {
    return buildLyricaUrl(apiUrl, artist, song);
  }
  return buildLrclibGetUrl(apiUrl, artist, song, duration);
}

export async function fetchLrclibLyrics({
  apiUrl = DEFAULT_LRCLIB_API_URL,
  artist,
  duration,
  fetchImpl = fetch,
  song,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  userAgent = DEFAULT_LRCLIB_USER_AGENT,
}) {
  const headers = {
    accept: "application/json",
    "user-agent": userAgent,
  };

  const targetUrl = getProviderRequestUrl(apiUrl, artist, song, duration);

  let response;
  try {
    response = await fetchImpl(targetUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new LrclibProviderError("Unable to reach lyrics provider", {
      kind: error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "network",
    });
  }

  if (response.status === 404) {
    // Attempt fallback search if calling LRCLIB standard API
    if (!apiUrl.includes("/lyrics")) {
      try {
        const searchRes = await fetchImpl(buildLrclibSearchUrl(apiUrl, artist, song), {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (searchRes.ok) {
          const list = await searchRes.json();
          if (Array.isArray(list) && list.length > 0) {
            const matchWithSynced = list.find(
              (item) => typeof item?.syncedLyrics === "string" && item.syncedLyrics.trim().length > 0
            );
            if (matchWithSynced) {
              return normalizeLrclibLyrics(matchWithSynced, duration);
            }
          }
        }
      } catch {
        // Fallback search failure is non-fatal; treat as miss
      }
    }
    return null;
  }

  if (response.status === 429) {
    throw new LrclibProviderError("Lyrics provider rate limit reached", {
      kind: "rate-limit",
      retryAfter: parseRetryAfter(response.headers.get("retry-after")),
    });
  }

  if (!response.ok) {
    throw new LrclibProviderError(`Lyrics provider returned HTTP ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new LrclibProviderError("Lyrics provider returned invalid JSON", { kind: "malformed" });
  }

  return normalizeLrclibLyrics(payload, duration);
}

export function getLrclibCacheKey(artist, song) {
  const identity = `${normalizeLyricsIdentity(artist)}\u0000${normalizeLyricsIdentity(song)}`;
  return `lyrics:lrclib:v1:${createHash("sha256").update(identity).digest("hex")}`;
}

export function normalizeLyricsIdentity(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

async function readCache(redis, key, log) {
  try {
    const cached = await redis.get(key);
    if (!cached) return undefined;
    const parsed = JSON.parse(cached);
    return parsed.missing === true ? null : parsed;
  } catch (error) {
    log?.warn({ err: error }, "Unable to read lyrics cache");
    return undefined;
  }
}

async function writeCache(redis, key, value, ttl, log) {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  } catch (error) {
    log?.warn({ err: error }, "Unable to write lyrics cache");
  }
}

export async function resolveLrclibLyrics({
  artist,
  duration,
  fetchImpl,
  log,
  redis,
  song,
  config = getLrclibConfig(),
}) {
  const cacheKey = getLrclibCacheKey(artist, song);
  const cached = await readCache(redis, cacheKey, log);
  if (cached !== undefined) return cached;

  const lyrics = await fetchLrclibLyrics({
    ...config,
    artist,
    duration,
    fetchImpl,
    song,
  });

  if (lyrics) {
    await writeCache(redis, cacheKey, lyrics, LRCLIB_SUCCESS_TTL_SECONDS, log);
  } else {
    await writeCache(redis, cacheKey, { missing: true }, LRCLIB_MISS_TTL_SECONDS, log);
  }
  return lyrics;
}
