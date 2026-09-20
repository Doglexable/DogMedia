import { execFile, spawn } from "child_process";
import { mkdir, rename, rm, stat } from "fs/promises";
import { dirname, extname, join } from "path";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { ENCODING_GROUP, ENCODING_STREAM } from "./encoding-queue.js";
import { ENCODED_QUALITIES, ENCODING_PRESETS, mediaKind, shouldCreateVariant } from "./media-quality.js";

const execFileAsync = promisify(execFile);
const DEFAULT_IDLE_MS = 60_000;

export function parseStreamFields(values = []) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) result[values[index]] = values[index + 1];
  return result;
}

export async function probeSource(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=bit_rate,duration:stream=codec_type,width,height,bit_rate",
    "-of", "json", filePath,
  ]);
  const data = JSON.parse(stdout || "{}");
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  const audioStreamCount = data.streams?.filter((stream) => stream.codec_type === "audio").length || 0;
  const subtitleStreamCount = data.streams?.filter((stream) => stream.codec_type === "subtitle").length || 0;
  return {
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
    audioStreamCount,
    subtitleStreamCount,
    bitrate: Number(data.format?.bit_rate || video?.bit_rate || audio?.bit_rate || 0),
    duration: Number(data.format?.duration || 0),
    videoBitrate: Number(video?.bit_rate || 0),
    audioBitrate: Number(audio?.bit_rate || 0),
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
  };
}

export function outputExtension(kind) {
  if (kind === "audio") return "m4a";
  if (kind === "video") return "mp4";
  if (kind === "image") return "webp";
  return "bin";
}

export function outputMime(kind) {
  if (kind === "audio") return "audio/mp4";
  if (kind === "video") return "video/mp4";
  if (kind === "image") return "image/webp";
  return "application/octet-stream";
}

export function ffmpegArgs({ inputPath, kind, outputPath, preset }) {
  if (kind === "audio") return [
    "-y", "-i", inputPath, "-vn", "-c:a", "aac", "-b:a", `${preset.bitrate}`,
    "-movflags", "+faststart", outputPath,
  ];
  if (kind === "video") return [
    "-y", "-i", inputPath,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", `scale=-2:'min(${preset.height},ih)'`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-b:v", `${preset.bitrate}`,
    "-maxrate", `${preset.bitrate}`, "-bufsize", `${preset.bitrate * 2}`,
    "-c:a", "aac", "-b:a", `${preset.audioBitrate}`, "-ac", "2", "-ar", "48000",
    "-movflags", "+faststart", outputPath,
  ];
  return [
    "-y", "-i", inputPath,
    "-vf", `scale='if(gt(iw,ih),min(${preset.longEdge},iw),-2)':'if(gt(iw,ih),-2,min(${preset.longEdge},ih))':force_original_aspect_ratio=decrease`,
    "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", outputPath,
  ];
}

export function validateEncodedStreams(kind, source, encoded) {
  if (kind === "video" && !encoded.hasVideo) throw new Error("Encoded video is missing its video stream");
  if (kind === "video" && source.hasAudio && !encoded.hasAudio) {
    throw new Error("Encoded video is missing its source audio stream");
  }
  if (kind === "audio" && !encoded.hasAudio) throw new Error("Encoded audio is missing its audio stream");
}

async function markVariant(pg, { mediaId, sourceVersion, quality, status, values = {} }) {
  await pg.query(
    `UPDATE media_encoding_variants
     SET status = $4, file_path = $5, mime_type = $6, bitrate = $7,
         width = $8, height = $9, byte_size = $10, last_error = $11,
         attempts = attempts + $12,
         progress_percent = COALESCE($13, progress_percent), updated_at = NOW()
     WHERE media_id = $1 AND source_version = $2 AND quality = $3`,
    [mediaId, sourceVersion, quality, status, values.filePath || null, values.mimeType || null,
      values.bitrate || null, values.width || null, values.height || null,
      values.byteSize || null, values.error || null, values.incrementAttempt ? 1 : 0,
      values.progressPercent ?? null]
  );
}

export function encodingProgressPercent(line, durationSeconds) {
  if (line === "progress=end") return 100;
  if (!line.startsWith("out_time_ms=") || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const elapsedMicroseconds = Number(line.slice("out_time_ms=".length));
  if (!Number.isFinite(elapsedMicroseconds) || elapsedMicroseconds < 0) return null;
  return Math.max(0, Math.min(99, Math.floor((elapsedMicroseconds / (durationSeconds * 1_000_000)) * 100)));
}

export function runFfmpegWithProgress({ args, durationSeconds, onProgress, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    const outputPath = args.at(-1);
    const child = spawnImpl("ffmpeg", [
      ...args.slice(0, -1),
      "-progress", "pipe:1",
      "-nostats",
      outputPath,
    ]);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) {
        const percent = encodingProgressPercent(line, durationSeconds);
        if (percent !== null) onProgress?.(percent);
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => {
      if (code === 0) finish(resolve);
      else finish(reject, new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

async function updateVariantProgress(pg, { mediaId, progressPercent, quality, sourceVersion }) {
  await pg.query(
    `UPDATE media_encoding_variants SET progress_percent = $4, updated_at = NOW()
     WHERE media_id = $1 AND source_version = $2 AND quality = $3 AND status = 'processing'`,
    [mediaId, sourceVersion, quality, progressPercent]
  );
}

export async function processEncodingJob({ dataDir, log, mediaId, pg, sourceVersion }) {
  const { rows } = await pg.query(
    "SELECT id, category_id, file_path, mime_type, source_version FROM media_assets WHERE id = $1",
    [mediaId]
  );
  const media = rows[0];
  if (!media || Number(media.source_version) !== Number(sourceVersion)) return { stale: true };
  const kind = mediaKind(media.mime_type);
  if (!kind) {
    for (const quality of ENCODED_QUALITIES) {
      await markVariant(pg, { mediaId, sourceVersion, quality, status: "skipped", values: { progressPercent: 100 } });
    }
    return { skipped: ENCODED_QUALITIES.length };
  }

  const inputPath = join(dataDir, media.file_path);
  const source = await probeSource(inputPath);
  const { rows: variantRows } = await pg.query(
    "SELECT quality, status FROM media_encoding_variants WHERE media_id = $1 AND source_version = $2",
    [mediaId, sourceVersion]
  );
  const variantStatus = new Map(variantRows.map((variant) => [variant.quality, variant.status]));
  const outputDir = join(dataDir, String(media.category_id), String(mediaId), `v${sourceVersion}`);
  await mkdir(outputDir, { recursive: true });
  let created = 0;
  let skipped = 0;

  for (const quality of ENCODED_QUALITIES) {
    if (["ready", "skipped"].includes(variantStatus.get(quality))) continue;
    const preset = ENCODING_PRESETS[kind][quality];
    if (!shouldCreateVariant(kind, source, preset)) {
      await markVariant(pg, { mediaId, sourceVersion, quality, status: "skipped", values: { progressPercent: 100 } });
      skipped += 1;
      continue;
    }
    await markVariant(pg, {
      mediaId, sourceVersion, quality, status: "processing",
      values: { incrementAttempt: true, progressPercent: 0 },
    });
    const ext = outputExtension(kind);
    const relativePath = `${media.category_id}/${mediaId}/v${sourceVersion}/${quality}.${ext}`;
    const outputPath = join(dataDir, relativePath);
    const temporaryPath = join(dirname(outputPath), `.${quality}-${randomUUID()}${extname(outputPath)}`);
    try {
      const boundedPreset = kind === "audio"
        ? { ...preset, bitrate: Math.min(source.audioBitrate || source.bitrate || preset.bitrate, preset.bitrate) }
        : kind === "video"
          ? {
              ...preset,
              bitrate: Math.min(source.videoBitrate || source.bitrate || preset.bitrate, preset.bitrate),
              audioBitrate: Math.min(source.audioBitrate || preset.audioBitrate, preset.audioBitrate),
            }
          : preset;
      let lastReportedProgress = -1;
      let progressUpdates = Promise.resolve();
      await runFfmpegWithProgress({
        args: ffmpegArgs({ inputPath, kind, outputPath: temporaryPath, preset: boundedPreset }),
        durationSeconds: source.duration,
        onProgress(progressPercent) {
          if (progressPercent < 100 && progressPercent < lastReportedProgress + 2) return;
          lastReportedProgress = progressPercent;
          progressUpdates = progressUpdates.then(() => updateVariantProgress(pg, {
            mediaId, progressPercent, quality, sourceVersion,
          }));
        },
      });
      await progressUpdates;
      const current = await pg.query("SELECT source_version FROM media_assets WHERE id = $1", [mediaId]);
      if (Number(current.rows[0]?.source_version) !== Number(sourceVersion)) {
        await rm(temporaryPath, { force: true });
        return { stale: true, created, skipped };
      }
      const encoded = await probeSource(temporaryPath);
      validateEncodedStreams(kind, source, encoded);
      await rename(temporaryPath, outputPath);
      const outputStats = await stat(outputPath);
      await markVariant(pg, {
        mediaId, sourceVersion, quality, status: "ready",
        values: { filePath: relativePath, mimeType: outputMime(kind), byteSize: outputStats.size, progressPercent: 100, ...encoded },
      });
      created += 1;
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      await markVariant(pg, {
        mediaId, sourceVersion, quality, status: "failed",
        values: { error: String(error.message || error).slice(0, 4000) },
      });
      log?.error?.({ err: error, mediaId, quality }, "media encoding failed");
      throw error;
    }
  }
  return { created, skipped };
}

async function ensureGroup(redis) {
  try {
    await redis.xgroup("CREATE", ENCODING_STREAM, ENCODING_GROUP, "0", "MKSTREAM");
  } catch (error) {
    if (!String(error.message).includes("BUSYGROUP")) throw error;
  }
}

export function isEncodingWindowOpen(now = new Date(), startHour = 0, endHour = 5) {
  const hour = now.getHours();
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

export function millisecondsUntilEncodingWindow(now = new Date(), startHour = 0, endHour = 5) {
  if (isEncodingWindowOpen(now, startHour, endHour)) return 0;
  const next = new Date(now);
  next.setHours(startHour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function waitForEncodingWindow(delayMs, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted || delayMs <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, delayMs);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export async function runEncodingWorker({ dataDir, log, pg, redis, consumer, signal, scheduleEndHour = 5, scheduleHour = null }) {
  await ensureGroup(redis);
  while (!signal?.aborted) {
    if (scheduleHour !== null && !isEncodingWindowOpen(new Date(), scheduleHour, scheduleEndHour)) {
      const delayMs = millisecondsUntilEncodingWindow(new Date(), scheduleHour, scheduleEndHour);
      log?.info?.({ consumer, nextRunInMs: delayMs, scheduleEndHour, scheduleHour }, "resolution encoder waiting for nightly window");
      await waitForEncodingWindow(delayMs, signal);
      continue;
    }
    let messages = [];
    try {
      const reclaimed = await redis.xautoclaim(ENCODING_STREAM, ENCODING_GROUP, consumer, DEFAULT_IDLE_MS, "0-0", "COUNT", 1);
      messages = reclaimed?.[1] || [];
      if (!messages.length) {
        const response = await redis.xreadgroup("GROUP", ENCODING_GROUP, consumer, "COUNT", 1, "BLOCK", 5000, "STREAMS", ENCODING_STREAM, ">");
        messages = response?.[0]?.[1] || [];
      }
      for (const [messageId, rawFields] of messages) {
        const fields = parseStreamFields(rawFields);
        const mediaId = Number(fields.mediaId);
        const sourceVersion = Number(fields.sourceVersion);
        try {
          await processEncodingJob({ dataDir, log, mediaId, pg, sourceVersion });
          await redis.xack(ENCODING_STREAM, ENCODING_GROUP, messageId);
        } catch (error) {
          const { rows } = await pg.query(
            `SELECT COALESCE(MAX(attempts), 0)::int AS attempts
             FROM media_encoding_variants WHERE media_id = $1 AND source_version = $2`,
            [mediaId, sourceVersion]
          );
          const attempts = Number(rows[0]?.attempts || 0);
          if (attempts >= 3) {
            await redis.xack(ENCODING_STREAM, ENCODING_GROUP, messageId);
          } else {
            await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempts * 1000, 30_000)));
            await pg.query(
              `UPDATE media_encoding_variants SET status = 'queued', progress_percent = 0, updated_at = NOW()
               WHERE media_id = $1 AND source_version = $2 AND status = 'failed'`,
              [mediaId, sourceVersion]
            );
            await redis.xadd(ENCODING_STREAM, "*", "mediaId", String(mediaId), "sourceVersion", String(sourceVersion));
            await redis.xack(ENCODING_STREAM, ENCODING_GROUP, messageId);
          }
        }
      }
    } catch (error) {
      log?.error?.({ err: error }, "encoding worker loop failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
