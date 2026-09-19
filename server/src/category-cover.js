import { createReadStream } from "fs";
import { mkdir, rename, stat, unlink } from "fs/promises";
import { execFile } from "child_process";
import { join } from "path";
import { promisify } from "util";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);
export const THUMBNAIL_WEBP_QUALITY = 90;
const THUMBNAIL_WEBP_COMPRESSION_LEVEL = 6;

function webpOutputArgs(outputPath) {
  return [
    "-frames:v", "1",
    "-map_metadata", "-1",
    "-c:v", "libwebp",
    "-quality", String(THUMBNAIL_WEBP_QUALITY),
    "-compression_level", String(THUMBNAIL_WEBP_COMPRESSION_LEVEL),
    outputPath,
  ];
}

export async function normalizeCategoryCover({ categoryId, dataDir, inputPath }) {
  const categoryDir = join(dataDir, String(categoryId));
  await mkdir(categoryDir, { recursive: true });
  const version = randomUUID();
  const filename = `front-${version}.webp`;
  const outputPath = join(categoryDir, filename);
  const temporaryPath = join(categoryDir, `.pending-${filename}`);
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", "scale='if(gt(iw,ih),min(518,iw),-2)':'if(gt(iw,ih),-2,min(518,ih))':force_original_aspect_ratio=decrease",
      ...webpOutputArgs(temporaryPath),
    ]);
    const result = await stat(temporaryPath);
    if (!result.size) throw new Error("Generated cover is empty");
    await rename(temporaryPath, outputPath);
    return `${categoryId}/${filename}`;
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

export async function normalizeMediaCover({ categoryId, mediaId, dataDir, inputPath }) {
  const mediaDir = join(dataDir, String(categoryId), String(mediaId));
  await mkdir(mediaDir, { recursive: true });
  const version = randomUUID();
  const filename = `cover-${version}.webp`;
  const outputPath = join(mediaDir, filename);
  const temporaryPath = join(mediaDir, `.pending-${filename}`);
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", "scale='if(gt(iw,ih),min(900,iw),-2)':'if(gt(iw,ih),-2,min(900,ih))':force_original_aspect_ratio=decrease",
      ...webpOutputArgs(temporaryPath),
    ]);
    const result = await stat(temporaryPath);
    if (!result.size) throw new Error("Generated media cover is empty");
    await rename(temporaryPath, outputPath);
    return `${categoryId}/${mediaId}/${filename}`;
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

export function sendCoverFile({ request, reply, filePath, stats }) {
  const etag = `W/\"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}\"`;
  reply.header("Cache-Control", "private, no-cache, max-age=0, must-revalidate");
  reply.header("Content-Disposition", "inline");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("ETag", etag);
  reply.header("Last-Modified", stats.mtime.toUTCString());
  const modifiedSince = Date.parse(request.headers["if-modified-since"] || "");
  if (request.headers["if-none-match"] === etag
    || (!request.headers["if-none-match"] && Number.isFinite(modifiedSince) && stats.mtimeMs <= modifiedSince + 999)) {
    return reply.code(304).send();
  }
  reply.type("image/webp");
  return reply.send(createReadStream(filePath));
}
