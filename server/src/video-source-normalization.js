import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { rename, rm, stat } from "fs/promises";
import { dirname, extname, join } from "path";
import { promisify } from "util";
import { probeSource, validateEncodedStreams } from "./encoding-worker.js";

const execFileAsync = promisify(execFile);
const NORMALIZED_VIDEO_KINDS = new Set(["film", "video_episode"]);

export function shouldNormalizeMatroskaSource(media) {
  const filePath = String(media?.file_path || "").toLowerCase();
  return NORMALIZED_VIDEO_KINDS.has(media?.content_kind)
    && (media?.mime_type === "video/x-matroska" || filePath.endsWith(".mkv"));
}

export function matroskaToMp4Args(inputPath, outputPath) {
  return [
    "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
    "-map", "0:v:0", "-map", "0:a?", "-map", "0:s?",
    "-map_metadata", "0",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
    "-c:s", "mov_text",
    "-movflags", "+faststart",
    outputPath,
  ];
}

export function validateNormalizedSource(source, encoded) {
  validateEncodedStreams("video", source, encoded);
  if (Number(encoded.audioStreamCount || 0) < Number(source.audioStreamCount || 0)) {
    throw new Error("Normalized MP4 did not preserve every audio stream");
  }
  if (Number(encoded.subtitleStreamCount || 0) < Number(source.subtitleStreamCount || 0)) {
    throw new Error("Normalized MP4 did not preserve every subtitle stream");
  }
}

export async function normalizeMatroskaSource({
  dataDir,
  media,
  runFfmpeg = execFileAsync,
  probe = probeSource,
}) {
  if (!shouldNormalizeMatroskaSource(media)) return null;

  const inputPath = join(dataDir, media.file_path);
  const relativePath = `${media.category_id}/${media.id}.mp4`;
  const outputPath = join(dataDir, relativePath);
  const temporaryPath = join(dirname(outputPath), `.${media.id}-source-${randomUUID()}${extname(outputPath)}`);

  try {
    await runFfmpeg("ffmpeg", matroskaToMp4Args(inputPath, temporaryPath));
    const outputStats = await stat(temporaryPath);
    if (!outputStats.size) throw new Error("Normalized MP4 is empty");

    const [source, encoded] = await Promise.all([probe(inputPath), probe(temporaryPath)]);
    validateNormalizedSource(source, encoded);
    await rename(temporaryPath, outputPath);

    return {
      absolutePath: outputPath,
      filePath: relativePath,
      mimeType: "video/mp4",
      previousAbsolutePath: inputPath,
    };
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}
