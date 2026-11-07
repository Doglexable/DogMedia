import { createReadStream } from "fs";
import { mkdir, rename, stat, unlink } from "fs/promises";
import { execFile } from "child_process";
import { join } from "path";
import { promisify } from "util";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);
export const THUMBNAIL_WEBP_QUALITY = 90;
const THUMBNAIL_WEBP_COMPRESSION_LEVEL = 6;
export const THUMBNAIL_BLUR_QUALITY = 25;
const THUMBNAIL_BLUR_COMPRESSION_LEVEL = 6;

function webpOutputArgs(outputPath) {
  return [
    "-frames:v", "1",
    "-map_metadata", "-1",
    "-c:v", "libwebp",
    "-f", "webp",
    "-quality", String(THUMBNAIL_WEBP_QUALITY),
    "-compression_level", String(THUMBNAIL_WEBP_COMPRESSION_LEVEL),
    outputPath,
  ];
}

function webpBlurOutputArgs(outputPath) {
  return [
    "-frames:v", "1",
    "-map_metadata", "-1",
    "-c:v", "libwebp",
    "-f", "webp",
    "-quality", String(THUMBNAIL_BLUR_QUALITY),
    "-compression_level", String(THUMBNAIL_BLUR_COMPRESSION_LEVEL),
    outputPath,
  ];
}

export function blurPathFromCover(coverPath) {
  if (!coverPath || typeof coverPath !== "string") return null;
  if (coverPath.endsWith("-blur.webp")) return coverPath;
  if (coverPath.endsWith(".webp")) {
    return coverPath.replace(/\.webp$/, "-blur.webp");
  }
  return `${coverPath}-blur.webp`;
}

export async function generateBlurCover({ inputPath, outputPath }) {
  const temporaryPath = `${outputPath}.${randomUUID()}.webp`;
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", "scale='if(gt(iw,ih),min(48,iw),-2)':'if(gt(iw,ih),-2,min(48,ih))':force_original_aspect_ratio=decrease,boxblur=2:1",
      ...webpBlurOutputArgs(temporaryPath),
    ]);
    const result = await stat(temporaryPath);
    if (!result.size) throw new Error("Generated blur cover is empty");
    await rename(temporaryPath, outputPath);
    return result;
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

export async function unlinkCoverWithBlur(dataDir, coverPath) {
  if (!coverPath || typeof coverPath !== "string") return;
  const fullCoverPath = join(dataDir, coverPath);
  await unlink(fullCoverPath).catch(() => {});
  const blurCoverPath = blurPathFromCover(coverPath);
  if (blurCoverPath && blurCoverPath !== coverPath) {
    await unlink(join(dataDir, blurCoverPath)).catch(() => {});
  }
}

export async function normalizeCategoryCover({ categoryId, dataDir, inputPath }) {
  const categoryDir = join(dataDir, String(categoryId));
  await mkdir(categoryDir, { recursive: true });
  const version = randomUUID();
  const filename = `front-${version}.webp`;
  const blurFilename = `front-${version}-blur.webp`;
  const outputPath = join(categoryDir, filename);
  const blurOutputPath = join(categoryDir, blurFilename);
  const temporaryPath = join(categoryDir, `.pending-${filename}`);
  const temporaryBlurPath = join(categoryDir, `.pending-${blurFilename}`);
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", "scale='if(gt(iw,ih),min(518,iw),-2)':'if(gt(iw,ih),-2,min(518,ih))':force_original_aspect_ratio=decrease",
      ...webpOutputArgs(temporaryPath),
    ]);
    const result = await stat(temporaryPath);
    if (!result.size) throw new Error("Generated cover is empty");

    await execFileAsync("ffmpeg", [
      "-y", "-i", temporaryPath,
      "-vf", "scale='if(gt(iw,ih),min(48,iw),-2)':'if(gt(iw,ih),-2,min(48,ih))':force_original_aspect_ratio=decrease,boxblur=2:1",
      ...webpBlurOutputArgs(temporaryBlurPath),
    ]);
    const blurResult = await stat(temporaryBlurPath);
    if (!blurResult.size) throw new Error("Generated blur cover is empty");

    await rename(temporaryPath, outputPath);
    await rename(temporaryBlurPath, blurOutputPath);
    return `${categoryId}/${filename}`;
  } catch (err) {
    await unlink(outputPath).catch(() => {});
    await unlink(blurOutputPath).catch(() => {});
    throw err;
  } finally {
    await unlink(temporaryPath).catch(() => {});
    await unlink(temporaryBlurPath).catch(() => {});
  }
}

export async function normalizeMediaCover({ categoryId, mediaId, dataDir, inputPath }) {
  const mediaDir = join(dataDir, String(categoryId), String(mediaId));
  await mkdir(mediaDir, { recursive: true });
  const version = randomUUID();
  const filename = `cover-${version}.webp`;
  const blurFilename = `cover-${version}-blur.webp`;
  const outputPath = join(mediaDir, filename);
  const blurOutputPath = join(mediaDir, blurFilename);
  const temporaryPath = join(mediaDir, `.pending-${filename}`);
  const temporaryBlurPath = join(mediaDir, `.pending-${blurFilename}`);
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", "scale='if(gt(iw,ih),min(900,iw),-2)':'if(gt(iw,ih),-2,min(900,ih))':force_original_aspect_ratio=decrease",
      ...webpOutputArgs(temporaryPath),
    ]);
    const result = await stat(temporaryPath);
    if (!result.size) throw new Error("Generated media cover is empty");

    await execFileAsync("ffmpeg", [
      "-y", "-i", temporaryPath,
      "-vf", "scale='if(gt(iw,ih),min(48,iw),-2)':'if(gt(iw,ih),-2,min(48,ih))':force_original_aspect_ratio=decrease,boxblur=2:1",
      ...webpBlurOutputArgs(temporaryBlurPath),
    ]);
    const blurResult = await stat(temporaryBlurPath);
    if (!blurResult.size) throw new Error("Generated blur cover is empty");

    await rename(temporaryPath, outputPath);
    await rename(temporaryBlurPath, blurOutputPath);
    return `${categoryId}/${mediaId}/${filename}`;
  } catch (err) {
    await unlink(outputPath).catch(() => {});
    await unlink(blurOutputPath).catch(() => {});
    throw err;
  } finally {
    await unlink(temporaryPath).catch(() => {});
    await unlink(temporaryBlurPath).catch(() => {});
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
