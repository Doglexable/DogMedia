import { createHash } from "node:crypto";

import { LyricsValidationError, normalizeWhisperLyrics } from "./lyrics.js";

export const LYRICA_SUCCESS_TTL_SECONDS = 24 * 60 * 60;
export const LYRICA_MISS_TTL_SECONDS = 15 * 60;

const DEFAULT_API_URL = "https://wilooper-lyrica.hf.space";
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 15000;

export class LyricaProviderError extends Error {
  constructor(message, { kind = "upstream", retryAfter = null } = {}) {
    super(message);
    this.name = "LyricaProviderError";
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

export function getLyricaConfig(env = process.env) {
  const parsedTimeout = Number.parseInt(env.LYRICA_TIMEOUT_MS, 10);
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.min(Math.max(parsedTimeout, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;

  return {
    apiUrl: env.LYRICA_API_URL?.trim() || DEFAULT_API_URL,
    timeoutMs,
  };
}

export function buildLyricaUrl(apiUrl, artist, song) {
  const url = new URL(`${apiUrl.replace(/\/+$/, "")}/lyrics/`);
  url.searchParams.set("artist", artist);
  url.searchParams.set("song", song);
  url.searchParams.set("timestamps", "true");
  return url;
}

export function normalizeLyricaLyrics(payload) {
  if (!payload || typeof payload !== "object" || payload.status !== "success" || !payload.data) {
    throw new LyricaProviderError("Lyrica returned an invalid response", { kind: "malformed" });
  }

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
    throw new LyricaProviderError("Lyrica returned invalid timed lyrics", { kind: "malformed" });
  }

  try {
    return normalizeWhisperLyrics({
      language: typeof payload.data.language === "string" ? payload.data.language : "",
      segments,
    });
  } catch (error) {
    if (error instanceof LyricsValidationError) {
      throw new LyricaProviderError("Lyrica returned invalid timed lyrics", { kind: "malformed" });
    }
    throw error;
  }
}

function parseRetryAfter(value) {
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export async function fetchLyricaLyrics({ apiUrl, artist, fetchImpl = fetch, song, timeoutMs }) {
  let response;
  try {
    response = await fetchImpl(buildLyricaUrl(apiUrl, artist, song), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new LyricaProviderError("Unable to reach Lyrica", {
      kind: error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "network",
    });
  }

  if (response.status === 404) return null;
  if (response.status === 429) {
    throw new LyricaProviderError("Lyrica rate limit reached", {
      kind: "rate-limit",
      retryAfter: parseRetryAfter(response.headers.get("retry-after")),
    });
  }
  if (!response.ok) {
    throw new LyricaProviderError(`Lyrica returned HTTP ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new LyricaProviderError("Lyrica returned invalid JSON", { kind: "malformed" });
  }
  return normalizeLyricaLyrics(payload);
}

export function getLyricaCacheKey(artist, song) {
  const identity = `${normalizeLyricsIdentity(artist)}\u0000${normalizeLyricsIdentity(song)}`;
  return `lyrics:lyrica:v1:${createHash("sha256").update(identity).digest("hex")}`;
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
    log?.warn({ err: error }, "Unable to read Lyrica cache");
    return undefined;
  }
}

async function writeCache(redis, key, value, ttl, log) {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttl);
  } catch (error) {
    log?.warn({ err: error }, "Unable to write Lyrica cache");
  }
}

export async function resolveLyricaLyrics({ artist, fetchImpl, log, redis, song, config = getLyricaConfig() }) {
  const cacheKey = getLyricaCacheKey(artist, song);
  const cached = await readCache(redis, cacheKey, log);
  if (cached !== undefined) return cached;

  const lyrics = await fetchLyricaLyrics({
    ...config,
    artist,
    fetchImpl,
    song,
  });

  if (lyrics) {
    await writeCache(redis, cacheKey, lyrics, LYRICA_SUCCESS_TTL_SECONDS, log);
  } else {
    await writeCache(redis, cacheKey, { missing: true }, LYRICA_MISS_TTL_SECONDS, log);
  }
  return lyrics;
}
