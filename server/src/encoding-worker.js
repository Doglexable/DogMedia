import { execFile } from "child_process";
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
    "-v", "error", "-show_entries", "format=bit_rate:stream=codec_type,width,height,bit_rate",
    "-of", "json", filePath,
  ]);
  const data = JSON.parse(stdout || "{}");
  const video = data.streams?.find((stream) => stream.codec_type === "video");
  const audio = data.streams?.find((stream) => stream.codec_type === "audio");
  return {
    bitrate: Number(data.format?.bit_rate || video?.bit_rate || audio?.bit_rate || 0),
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
    "-vf", `scale=-2:'min(${preset.height},ih)'`,
    "-c:v", "libx264", "-preset", "medium", "-b:v", `${preset.bitrate}`,
    "-maxrate", `${preset.bitrate}`, "-bufsize", `${preset.bitrate * 2}`,
    "-c:a", "aac", "-b:a", `${preset.audioBitrate}`, "-movflags", "+faststart", outputPath,
  ];
  return [
    "-y", "-i", inputPath,
    "-vf", `scale='if(gt(iw,ih),min(${preset.longEdge},iw),-2)':'if(gt(iw,ih),-2,min(${preset.longEdge},ih))':force_original_aspect_ratio=decrease`,
    "-frames:v", "1", "-c:v", "libwebp", "-quality", "82", outputPath,
  ];
}

async function markVariant(pg, { mediaId, sourceVersion, quality, status, values = {} }) {
  await pg.query(
    `UPDATE media_encoding_variants
     SET status = $4, file_path = $5, mime_type = $6, bitrate = $7,
         width = $8, height = $9, byte_size = $10, last_error = $11,
         attempts = attempts + $12, updated_at = NOW()
     WHERE media_id = $1 AND source_version = $2 AND quality = $3`,
    [mediaId, sourceVersion, quality, status, values.filePath || null, values.mimeType || null,
      values.bitrate || null, values.width || null, values.height || null,
      values.byteSize || null, values.error || null, values.incrementAttempt ? 1 : 0]
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
      await markVariant(pg, { mediaId, sourceVersion, quality, status: "skipped" });
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
      await markVariant(pg, { mediaId, sourceVersion, quality, status: "skipped" });
      skipped += 1;
      continue;
    }
    await markVariant(pg, { mediaId, sourceVersion, quality, status: "processing", values: { incrementAttempt: true } });
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
      await execFileAsync("ffmpeg", ffmpegArgs({ inputPath, kind, outputPath: temporaryPath, preset: boundedPreset }));
      const current = await pg.query("SELECT source_version FROM media_assets WHERE id = $1", [mediaId]);
      if (Number(current.rows[0]?.source_version) !== Number(sourceVersion)) {
        await rm(temporaryPath, { force: true });
        return { stale: true, created, skipped };
      }
      await rename(temporaryPath, outputPath);
      const outputStats = await stat(outputPath);
      const encoded = await probeSource(outputPath);
      await markVariant(pg, {
        mediaId, sourceVersion, quality, status: "ready",
        values: { filePath: relativePath, mimeType: outputMime(kind), byteSize: outputStats.size, ...encoded },
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

export async function runEncodingWorker({ dataDir, log, pg, redis, consumer, signal }) {
  await ensureGroup(redis);
  while (!signal?.aborted) {
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
              `UPDATE media_encoding_variants SET status = 'queued', updated_at = NOW()
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
