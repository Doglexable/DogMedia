import { execFile } from "child_process";
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
const IDLE_MS = 60_000;
const DEFAULT_BRAND_ICON_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/public/favicon-96x96.png");

export function parseReelStreamFields(values = []) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) result[values[index]] = values[index + 1];
  return result;
}

export function reelSegmentArgs({
  audioPath, artworkPath, brandIconPath = DEFAULT_BRAND_ICON_PATH,
  clipStart = 0, outputPath,
}) {
  const visualInput = artworkPath
    ? ["-loop", "1", "-i", artworkPath]
    : ["-f", "lavfi", "-i", `color=c=0x17151f:s=${WIDTH}x${HEIGHT}:r=30`];
  const sceneFilter = artworkPath
    ? `[1:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},boxblur=24:12[bg];` +
      `[1:v]scale=520:520:force_original_aspect_ratio=decrease[art];` +
      `[bg][art]overlay=(W-w)/2:(H-h)/2[scene];`
    : "[1:v]format=rgba[scene];";
  const videoFilter = sceneFilter +
    `[2:v]scale=52:52:force_original_aspect_ratio=decrease[brandicon];` +
    `[scene][brandicon]overlay=30:26,format=yuv420p,fps=30[v]`;

  return [
    "-y", "-ss", String(Math.max(0, Number(clipStart) || 0)), "-i", audioPath,
    ...visualInput,
    "-loop", "1", "-i", brandIconPath,
    "-filter_complex", videoFilter,
    "-map", "[v]", "-map", "0:a:0",
    "-t", String(CLIP_SECONDS),
    "-af", `afade=t=in:st=0:d=0.2,afade=t=out:st=${CLIP_SECONDS - 0.5}:d=0.5,apad=pad_dur=${CLIP_SECONDS}`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-r", "30",
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
    for (let index = 0; index < items.length; index += 1) {
      if (!await reelIsActive(pg, reelId)) return { stale: true };
      const item = items[index];
      const segmentPath = join(jobDir, `${String(index + 1).padStart(2, "0")}.mp4`);
      await runFfmpeg("ffmpeg", reelSegmentArgs({
        audioPath: join(dataDir, item.file_path),
        artworkPath: item.artwork_path ? join(dataDir, item.artwork_path) : null,
        brandIconPath: process.env.MUSIC_REEL_BRAND_ICON || DEFAULT_BRAND_ICON_PATH,
        clipStart: item.clip_start,
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
