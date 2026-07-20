import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_QUALITY = 75;
const THUMBNAIL_PATTERN = /_thumb\.(?:jpe?g|png|webp)$/i;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const nextUnit of units) {
    value /= 1024;
    unit = nextUnit;
    if (value < 1024) break;
  }
  return `${value.toFixed(2)} ${unit}`;
}

async function collectThumbnails(directory) {
  const thumbnails = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === ".thumbnail-backups") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      thumbnails.push(...await collectThumbnails(path));
    } else if (entry.isFile() && THUMBNAIL_PATTERN.test(entry.name)) {
      thumbnails.push(path);
    }
  }

  return thumbnails;
}

async function askQuality() {
  if (!process.stdin.isTTY) return DEFAULT_QUALITY;

  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = (await input.question(`Thumbnail compression quality (1-100) [${DEFAULT_QUALITY}%]: `)).trim();
      if (!answer) return DEFAULT_QUALITY;

      const normalized = answer.endsWith("%") ? answer.slice(0, -1).trim() : answer;
      const quality = Number(normalized);
      if (Number.isInteger(quality) && quality >= 1 && quality <= 100) return quality;

      console.error("Enter a whole number from 1 to 100, for example 50%.");
    }
  } finally {
    input.close();
  }
}

function compressionArgs(inputPath, outputPath, quality) {
  const extension = extname(inputPath).toLowerCase();
  const common = ["-y", "-v", "error", "-i", inputPath, "-frames:v", "1", "-map_metadata", "-1"];

  if (extension === ".webp") {
    return [...common, "-c:v", "libwebp", "-quality", String(quality), "-compression_level", "6", outputPath];
  }

  if (extension === ".png") {
    const maxColors = Math.max(2, Math.round(2 + (quality / 100) * 254));
    const paletteFilter = `split[source][paletteInput];[paletteInput]palettegen=max_colors=${maxColors}[palette];[source][palette]paletteuse=dither=bayer`;
    return [...common, "-vf", paletteFilter, "-compression_level", "9", outputPath];
  }

  const jpegScale = Math.max(2, Math.min(31, Math.round(31 - (quality / 100) * 29)));
  return [...common, "-q:v", String(jpegScale), outputPath];
}

async function compressThumbnail(inputPath, quality, sequence) {
  const extension = extname(inputPath);
  const temporaryPath = `${inputPath.slice(0, -extension.length)}.compressing-${process.pid}-${sequence}${extension}`;
  const before = await stat(inputPath);

  try {
    await execFileAsync("ffmpeg", compressionArgs(inputPath, temporaryPath, quality));
    const after = await stat(temporaryPath);

    if (after.size >= before.size) {
      await unlink(temporaryPath);
      return { before: before.size, after: before.size, skipped: true };
    }

    await rename(temporaryPath, inputPath);
    return { before: before.size, after: after.size, skipped: false };
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function main() {
  const mediaRoot = resolve(process.env.DATA_DIR || "data/media");
  const quality = await askQuality();

  await execFileAsync("ffmpeg", ["-version"]).catch(() => {
    throw new Error("ffmpeg is required but was not found in PATH.");
  });

  const thumbnails = await collectThumbnails(mediaRoot);
  if (thumbnails.length === 0) {
    console.log(`No thumbnails found under ${mediaRoot}`);
    return;
  }

  const backupRoot = join(mediaRoot, ".thumbnail-backups", timestamp());
  console.log(`Found ${thumbnails.length} thumbnail(s).`);
  console.log(`Quality: ${quality}%`);
  console.log(`Backing up originals to ${backupRoot}`);

  for (const thumbnail of thumbnails) {
    const backupPath = join(backupRoot, relative(mediaRoot, thumbnail));
    await mkdir(dirname(backupPath), { recursive: true });
    await copyFile(thumbnail, backupPath);
  }

  let compressed = 0;
  let skipped = 0;
  let failed = 0;
  let originalBytes = 0;
  let resultBytes = 0;

  for (const [index, thumbnail] of thumbnails.entries()) {
    const label = relative(mediaRoot, thumbnail);
    try {
      const result = await compressThumbnail(thumbnail, quality, index);
      originalBytes += result.before;
      resultBytes += result.after;
      if (result.skipped) {
        skipped += 1;
        console.log(`skip  ${label} (compressed copy was not smaller)`);
      } else {
        compressed += 1;
        console.log(`done  ${label}: ${formatBytes(result.before)} -> ${formatBytes(result.after)}`);
      }
    } catch (error) {
      failed += 1;
      const current = await stat(thumbnail).catch(() => ({ size: 0 }));
      originalBytes += current.size;
      resultBytes += current.size;
      console.error(`fail  ${label}: ${error.message}`);
    }
  }

  console.log("");
  console.log(`Compressed: ${compressed}, skipped: ${skipped}, failed: ${failed}`);
  console.log(`Size: ${formatBytes(originalBytes)} -> ${formatBytes(resultBytes)} (saved ${formatBytes(originalBytes - resultBytes)})`);
  console.log(`Originals: ${backupRoot}`);

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Thumbnail compression failed: ${error.message}`);
  process.exitCode = 1;
});
