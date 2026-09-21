import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, rename, rm, stat, writeFile } from "fs/promises";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { MUSIC_REEL_GROUP, MUSIC_REEL_STREAM } from "./music-reel-queue.js";

const execFileAsync = promisify(execFile);
const CLIP_SECONDS = 10;
const WIDTH = 960;
const HEIGHT = 720;
const MAX_ATTEMPTS = 3;
export const IDLE_MS = Number.parseInt(process.env.MUSIC_REEL_WORKER_CLAIM_IDLE_MS || "1800000", 10);
const DEFAULT_BRAND_ICON_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/public/favicon-96x96.png");
const DEFAULT_TITLE_FONT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/fonts/inter-900.woff2");
const DEFAULT_ARTIST_FONT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/fonts/inter-700.woff2");
const DEFAULT_FONT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/fonts/inter.woff2");

const FALLBACK_FONT_PATHS = [
  resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
  resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/@fontsource-variable/inter/files/inter-latin-standard-normal.woff2"),
];

const FALLBACK_TITLE_FONT_PATHS = [
  resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/@fontsource/inter/files/inter-latin-900-normal.woff2"),
  DEFAULT_FONT_PATH,
  ...FALLBACK_FONT_PATHS,
];

const FALLBACK_ARTIST_FONT_PATHS = [
  resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2"),
  DEFAULT_FONT_PATH,
  ...FALLBACK_FONT_PATHS,
];

const CJK_BOLD_FONT_PATHS = [
  "/usr/share/fonts/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
];

const CJK_REGULAR_FONT_PATHS = [
  "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
];

export function getDefaultFontPath(customPath) {
  if (customPath && existsSync(customPath)) return customPath;
  if (process.env.MUSIC_REEL_FONT_PATH && existsSync(process.env.MUSIC_REEL_FONT_PATH)) {
    return process.env.MUSIC_REEL_FONT_PATH;
  }
  if (existsSync(DEFAULT_FONT_PATH)) return DEFAULT_FONT_PATH;
  for (const fallback of FALLBACK_FONT_PATHS) {
    if (existsSync(fallback)) return fallback;
  }
  return null;
}

export function getDefaultTitleFontPath(customPath) {
  if (customPath && existsSync(customPath)) return customPath;
  if (process.env.MUSIC_REEL_TITLE_FONT_PATH && existsSync(process.env.MUSIC_REEL_TITLE_FONT_PATH)) {
    return process.env.MUSIC_REEL_TITLE_FONT_PATH;
  }
  if (existsSync(DEFAULT_TITLE_FONT_PATH)) return DEFAULT_TITLE_FONT_PATH;
  for (const fallback of FALLBACK_TITLE_FONT_PATHS) {
    if (existsSync(fallback)) return fallback;
  }
  return getDefaultFontPath(customPath);
}

export function getDefaultArtistFontPath(customPath) {
  if (customPath && existsSync(customPath)) return customPath;
  if (process.env.MUSIC_REEL_ARTIST_FONT_PATH && existsSync(process.env.MUSIC_REEL_ARTIST_FONT_PATH)) {
    return process.env.MUSIC_REEL_ARTIST_FONT_PATH;
  }
  if (existsSync(DEFAULT_ARTIST_FONT_PATH)) return DEFAULT_ARTIST_FONT_PATH;
  for (const fallback of FALLBACK_ARTIST_FONT_PATHS) {
    if (existsSync(fallback)) return fallback;
  }
  return getDefaultFontPath(customPath);
}

export function containsNonLatin(text) {
  return /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\u20A0-\u20CF]/.test(String(text ?? ""));
}

export function getUnicodeFallbackFontPath({ bold = false, customPath } = {}) {
  if (customPath && existsSync(customPath)) return customPath;
  const envPath = bold ? process.env.MUSIC_REEL_CJK_BOLD_FONT_PATH : process.env.MUSIC_REEL_CJK_FONT_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  if (process.env.MUSIC_REEL_CJK_FONT_PATH && existsSync(process.env.MUSIC_REEL_CJK_FONT_PATH)) {
    return process.env.MUSIC_REEL_CJK_FONT_PATH;
  }
  const candidates = bold ? CJK_BOLD_FONT_PATHS : CJK_REGULAR_FONT_PATHS;
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function fontFilterArg(fontFilePath, fallbackFontName) {
  if (fontFilePath) {
    return `fontfile='${escapeFfmpegFilterValue(fontFilePath)}':`;
  }
  if (fallbackFontName) {
    return `font='${escapeFfmpegFilterValue(fallbackFontName)}':`;
  }
  return "";
}

export function escapeFfmpegFilterValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

export function formatText(text, maxLength = 45) {
  const trimmed = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trim()}…`;
}

export function parseReelStreamFields(values = []) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) result[values[index]] = values[index + 1];
  return result;
}

export function reelSegmentArgs({
  audioPath, artworkPath, brandIconPath = DEFAULT_BRAND_ICON_PATH,
  fontPath = getDefaultFontPath(),
  titleFontPath = getDefaultTitleFontPath(),
  artistFontPath = getDefaultArtistFontPath(),
  cjkFontPath = getUnicodeFallbackFontPath({ bold: false }),
  cjkBoldFontPath = getUnicodeFallbackFontPath({ bold: true }),
  clipStart = 0,
  title = "Unknown Title", titleFile,
  artist = "Unknown Artist", artistFile,
  badge = "Dogmedia", badgeFile,
  outputPath,
}) {
  const resolvedFont = getDefaultFontPath(fontPath);
  const resolvedTitleFont = getDefaultTitleFontPath(titleFontPath) || resolvedFont;
  const resolvedArtistFont = getDefaultArtistFontPath(artistFontPath) || resolvedFont;
  const resolvedCjk = getUnicodeFallbackFontPath({ bold: false, customPath: cjkFontPath });
  const resolvedCjkBold = getUnicodeFallbackFontPath({ bold: true, customPath: cjkBoldFontPath });

  const visualInput = artworkPath
    ? ["-loop", "1", "-i", artworkPath]
    : ["-f", "lavfi", "-i", `color=c=0x121318:s=${WIDTH}x${HEIGHT}:r=30`];

  let filter = artworkPath
    ? `[1:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},boxblur=28:14[blurred];` +
      `color=c=black@0.42:s=${WIDTH}x${HEIGHT}[scrim];` +
      `[blurred][scrim]overlay=0:0[bg];` +
      `color=c=black@0.55:s=400x400[artshadow];` +
      `[1:v]scale=390:390:force_original_aspect_ratio=increase,crop=390:390,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.15:t=1[art];` +
      `[2:v]scale=38:38:force_original_aspect_ratio=decrease[brandicon];` +
      `[bg][artshadow]overlay=(W-w)/2:95[s1];` +
      `[s1][art]overlay=(W-w)/2:100[s2];` +
      `[s2][brandicon]overlay=44:36[s3];`
    : `[1:v]format=rgba[bg];` +
      `color=c=0x1e2029:s=390x390,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.12:t=1[artcard];` +
      `[2:v]scale=120:120:force_original_aspect_ratio=decrease[largeicon];` +
      `[artcard][largeicon]overlay=(W-w)/2:(H-h)/2[art];` +
      `[2:v]scale=38:38:force_original_aspect_ratio=decrease[brandicon];` +
      `[bg][art]overlay=(W-w)/2:100[s1];` +
      `[s1][brandicon]overlay=44:36[s2];`;

  let currentScene = artworkPath ? "[s3]" : "[s2]";

  const badgeHasNonLatin = containsNonLatin(badge);
  const badgeFont = badgeHasNonLatin ? (resolvedCjk || resolvedArtistFont || resolvedFont) : (resolvedArtistFont || resolvedFont);
  const badgeFontArg = fontFilterArg(badgeFont, badgeHasNonLatin ? "Noto Sans CJK JP,sans-serif" : "Inter,sans-serif");
  const badgeOpt = badgeFile
    ? `textfile='${escapeFfmpegFilterValue(badgeFile)}'`
    : (badge ? `text='${escapeFfmpegFilterValue(formatText(badge, 40))}':expansion=none` : null);
  if (badgeOpt) {
    filter += `${currentScene}drawtext=${badgeFontArg}${badgeOpt}:fontsize=20:fontcolor=white@0.95:shadowcolor=black@0.6:shadowx=0:shadowy=1:x=94:y=43[t1];`;
    currentScene = "[t1]";
  }

  const titleHasNonLatin = containsNonLatin(title);
  const titleFont = titleHasNonLatin ? (resolvedCjkBold || resolvedCjk || resolvedTitleFont) : resolvedTitleFont;
  const titleFontArg = fontFilterArg(titleFont, titleHasNonLatin ? "Noto Sans CJK JP,sans-serif" : "Inter,sans-serif");
  const titleOpt = titleFile
    ? `textfile='${escapeFfmpegFilterValue(titleFile)}'`
    : (title ? `text='${escapeFfmpegFilterValue(formatText(title, titleHasNonLatin ? 20 : 32))}':expansion=none` : null);
  if (titleOpt) {
    filter += `${currentScene}drawtext=${titleFontArg}${titleOpt}:fontsize=42:fontcolor=white:shadowcolor=black@0.7:shadowx=0:shadowy=2:x=(w-text_w)/2:y=516[t2];`;
    currentScene = "[t2]";
  }

  const artistHasNonLatin = containsNonLatin(artist);
  const artistFont = artistHasNonLatin ? (resolvedCjkBold || resolvedCjk || resolvedArtistFont) : resolvedArtistFont;
  const artistFontArg = fontFilterArg(artistFont, artistHasNonLatin ? "Noto Sans CJK JP,sans-serif" : "Inter,sans-serif");
  const artistOpt = artistFile
    ? `textfile='${escapeFfmpegFilterValue(artistFile)}'`
    : (artist ? `text='${escapeFfmpegFilterValue(formatText(artist, artistHasNonLatin ? 28 : 45))}':expansion=none` : null);
  if (artistOpt) {
    filter += `${currentScene}drawtext=${artistFontArg}${artistOpt}:fontsize=21:fontcolor=white@0.68:shadowcolor=black@0.6:shadowx=0:shadowy=1:x=(w-text_w)/2:y=568[t3];`;
    currentScene = "[t3]";
  }

  filter += `${currentScene}format=yuv420p,fps=30[v]`;

  return [
    "-y", "-ss", String(Math.max(0, Number(clipStart) || 0)), "-i", audioPath,
    ...visualInput,
    "-loop", "1", "-i", brandIconPath,
    "-filter_complex", filter,
    "-map", "[v]", "-map", "0:a:0",
    "-t", String(CLIP_SECONDS),
    "-af", `afade=t=in:st=0:d=0.2,afade=t=out:st=${CLIP_SECONDS - 0.5}:d=0.5,apad=pad_dur=${CLIP_SECONDS}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", outputPath,
  ];
}

function concatEntry(filePath) {
  return `file '${filePath.replaceAll("'", "'\\''")}'`;
}

async function updateReel(pg, reelId, values) {
  await pg.query(
    `UPDATE music_share_reels
     SET status = COALESCE($2, status), progress = COALESCE($3, progress),
         output_path = COALESCE($4, output_path), duration_seconds = COALESCE($5, duration_seconds),
         last_error = $6, attempts = attempts + $7, updated_at = NOW()
     WHERE id = $1`,
    [reelId, values.status || null, values.progress ?? null, values.outputPath || null,
      values.durationSeconds || null, values.error || null, values.incrementAttempt ? 1 : 0]
  );
}

async function reelIsActive(pg, reelId) {
  const { rows } = await pg.query(
    `SELECT 1 FROM music_share_reels
     WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       AND created_at > NOW() - INTERVAL '1 day'`,
    [reelId]
  );
  return rows.length > 0;
}

export async function processMusicReelJob({ dataDir, log, pg, reelId, runFfmpeg = execFileAsync }) {
  const { rows: reelRows } = await pg.query(
    `SELECT id, status FROM music_share_reels
     WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       AND created_at > NOW() - INTERVAL '1 day'`,
    [reelId]
  );
  if (!reelRows[0] || reelRows[0].status === "ready") return { stale: true };
  await updateReel(pg, reelId, { status: "processing", progress: 1, incrementAttempt: true });

  const { rows: items } = await pg.query(
    `SELECT i.position, i.source_version, i.clip_start, m.file_path,
            COALESCE(i.title, m.title) AS title,
            COALESCE(i.artists, m.artists) AS artists,
            COALESCE(m.thumbnail_path, c.cover_path) AS artwork_path,
            m.source_version AS current_source_version
     FROM music_share_reel_items i
     JOIN media_assets m ON m.id = i.media_id AND m.mime_type LIKE 'audio/%'
     JOIN categories c ON c.id = m.category_id
     WHERE i.reel_id = $1
     ORDER BY i.position`,
    [reelId]
  );
  if (!items.length) throw new Error("The reel has no tracks");
  if (items.some((item) => Number(item.source_version) !== Number(item.current_source_version))) {
    throw new Error("A selected track changed before the reel was rendered");
  }

  const shareDir = join(dataDir, "shares", "music-reels");
  const jobDir = join(shareDir, `.render-${reelId}-${randomUUID()}`);
  const finalPath = join(shareDir, `${reelId}.mp4`);
  const temporaryOutput = join(shareDir, `.${reelId}-${randomUUID()}.mp4`);
  await mkdir(jobDir, { recursive: true });

  try {
    const segments = [];
    const fontPath = process.env.MUSIC_REEL_FONT_PATH || getDefaultFontPath();
    const titleFontPath = process.env.MUSIC_REEL_TITLE_FONT_PATH || getDefaultTitleFontPath();
    const artistFontPath = process.env.MUSIC_REEL_ARTIST_FONT_PATH || getDefaultArtistFontPath();
    const cjkFontPath = process.env.MUSIC_REEL_CJK_FONT_PATH || getUnicodeFallbackFontPath({ bold: false });
    const cjkBoldFontPath = process.env.MUSIC_REEL_CJK_BOLD_FONT_PATH || getUnicodeFallbackFontPath({ bold: true });
    const brandIconPath = process.env.MUSIC_REEL_BRAND_ICON || DEFAULT_BRAND_ICON_PATH;

    for (let index = 0; index < items.length; index += 1) {
      if (!await reelIsActive(pg, reelId)) return { stale: true };
      const item = items[index];
      const segmentPath = join(jobDir, `${String(index + 1).padStart(2, "0")}.mp4`);
      const titlePath = join(jobDir, `title-${index}.txt`);
      const artistPath = join(jobDir, `artist-${index}.txt`);
      const badgePath = join(jobDir, `badge-${index}.txt`);

      const titleHasNonLatin = containsNonLatin(item.title);
      const artistHasNonLatin = containsNonLatin(item.artists);
      const titleText = formatText(item.title || "Unknown Title", titleHasNonLatin ? 20 : 32);
      const artistText = formatText(item.artists || "Unknown Artist", artistHasNonLatin ? 28 : 45);
      const badgeText = items.length > 1
        ? `Dogmedia  •  Track ${String(index + 1).padStart(2, "0")}/${String(items.length).padStart(2, "0")}`
        : "Dogmedia";

      await writeFile(titlePath, titleText, "utf8");
      await writeFile(artistPath, artistText, "utf8");
      await writeFile(badgePath, badgeText, "utf8");

      await runFfmpeg("ffmpeg", reelSegmentArgs({
        audioPath: join(dataDir, item.file_path),
        artworkPath: item.artwork_path ? join(dataDir, item.artwork_path) : null,
        brandIconPath,
        fontPath,
        titleFontPath,
        artistFontPath,
        cjkFontPath,
        cjkBoldFontPath,
        clipStart: item.clip_start,
        title: titleText,
        titleFile: titlePath,
        artist: artistText,
        artistFile: artistPath,
        badge: badgeText,
        badgeFile: badgePath,
        outputPath: segmentPath,
      }));
      segments.push(segmentPath);
      await updateReel(pg, reelId, { status: "processing", progress: Math.round(((index + 1) / items.length) * 85) });
    }

    const concatPath = join(jobDir, "segments.txt");
    await writeFile(concatPath, `${segments.map(concatEntry).join("\n")}\n`, "utf8");
    await runFfmpeg("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", concatPath,
      "-c", "copy", "-movflags", "+faststart", temporaryOutput,
    ]);
    if (!await reelIsActive(pg, reelId)) {
      await rm(temporaryOutput, { force: true });
      return { stale: true };
    }
    await rename(temporaryOutput, finalPath);
    const outputStats = await stat(finalPath);
    if (!outputStats.size) throw new Error("Rendered reel was empty");
    const outputPath = relative(resolve(dataDir), resolve(finalPath));
    await updateReel(pg, reelId, {
      status: "ready", progress: 100, outputPath,
      durationSeconds: items.length * CLIP_SECONDS,
    });
    return { ready: true, outputPath };
  } catch (error) {
    await rm(temporaryOutput, { force: true }).catch(() => {});
    await updateReel(pg, reelId, {
      status: "failed", progress: 0,
      error: String(error.message || error).slice(0, 4000),
    });
    log?.error?.({ err: error, reelId }, "music reel rendering failed");
    throw error;
  } finally {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function ensureGroup(redis) {
  try {
    await redis.xgroup("CREATE", MUSIC_REEL_STREAM, MUSIC_REEL_GROUP, "0", "MKSTREAM");
  } catch (error) {
    if (!String(error.message).includes("BUSYGROUP")) throw error;
  }
}

export async function runMusicReelWorker({ dataDir, log, pg, redis, consumer, signal }) {
  await ensureGroup(redis);
  while (!signal?.aborted) {
    try {
      let response = await redis.xautoclaim(MUSIC_REEL_STREAM, MUSIC_REEL_GROUP, consumer, IDLE_MS, "0-0", "COUNT", 1);
      let messages = response?.[1] || [];
      if (!messages.length) {
        response = await redis.xreadgroup("GROUP", MUSIC_REEL_GROUP, consumer, "COUNT", 1, "BLOCK", 5000, "STREAMS", MUSIC_REEL_STREAM, ">");
        messages = response?.[0]?.[1] || [];
      }
      for (const [messageId, rawFields] of messages) {
        const reelId = Number(parseReelStreamFields(rawFields).reelId);
        try {
          await processMusicReelJob({ dataDir, log, pg, reelId });
          await redis.xack(MUSIC_REEL_STREAM, MUSIC_REEL_GROUP, messageId);
        } catch (error) {
          const { rows } = await pg.query("SELECT attempts FROM music_share_reels WHERE id = $1", [reelId]);
          if (Number(rows[0]?.attempts || 0) < MAX_ATTEMPTS) {
            await pg.query(
              "UPDATE music_share_reels SET status = 'queued', progress = 0, updated_at = NOW() WHERE id = $1 AND revoked_at IS NULL",
              [reelId]
            );
            await redis.xadd(MUSIC_REEL_STREAM, "*", "reelId", String(reelId));
          } else {
            await pg.query(
              `UPDATE music_share_reels
               SET status = 'failed', progress = 0, last_error = $2, updated_at = NOW()
               WHERE id = $1 AND revoked_at IS NULL`,
              [reelId, String(error.message || error).slice(0, 4000)]
            );
          }
          await redis.xack(MUSIC_REEL_STREAM, MUSIC_REEL_GROUP, messageId);
        }
      }
    } catch (error) {
      log?.error?.({ err: error }, "music reel worker loop failed");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
  }
}
