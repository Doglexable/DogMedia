import { join } from "path";
import { rm, unlink } from "fs/promises";
import { normalizeCategoryCover, normalizeMediaCover } from "./category-cover.js";
import { enqueueEncoding } from "./encoding-queue.js";
import { parseStreamFields } from "./encoding-worker.js";
import { MEDIA_FINALIZATION_GROUP, MEDIA_FINALIZATION_STREAM } from "./media-finalization-queue.js";
import { probeDuration, probeMediaTags, resolveTrackOrder } from "./routes/media.js";
import { normalizeMatroskaSource } from "./video-source-normalization.js";

const DEFAULT_IDLE_MS = 60_000;
export const MAX_FINALIZATION_ATTEMPTS = 3;

export async function getMessageDeliveryAttempts({
  fields,
  group = MEDIA_FINALIZATION_GROUP,
  messageId,
  redis,
  stream = MEDIA_FINALIZATION_STREAM,
}) {
  const directAttempts = Number(fields?.attempts);
  if (Number.isFinite(directAttempts) && directAttempts > 0) {
    return directAttempts;
  }
  if (typeof redis?.xpending === "function") {
    try {
      const pending = await redis.xpending(stream, group, messageId, messageId, 1);
      const deliveryCount = Number(pending?.[0]?.[3]);
      if (Number.isFinite(deliveryCount) && deliveryCount > 0) {
        return deliveryCount;
      }
    } catch {
      // Ignored: fallback to 1
    }
  }
  return 1;
}

export async function processMediaFinalizationJob({
  dataDir,
  log,
  mediaId,
  pg,
  redis,
  sourceVersion,
  normalizeVideoSource = normalizeMatroskaSource,
}) {
  const { rows } = await pg.query(
    `SELECT m.*, c.cover_path
     FROM media_assets m
     JOIN categories c ON c.id = m.category_id
     WHERE m.id = $1`,
    [mediaId]
  );
  let media = rows[0];
  let normalizedSource = false;
  if (!media || Number(media.source_version) !== Number(sourceVersion)) return { stale: true };

  try {
    const normalized = await normalizeVideoSource({ dataDir, media });
    if (normalized) {
      let sourceUpdate;
      try {
        sourceUpdate = await pg.query(
          `UPDATE media_assets
           SET file_path = $1, mime_type = $2
           WHERE id = $3 AND source_version = $4
           RETURNING id`,
          [normalized.filePath, normalized.mimeType, mediaId, sourceVersion]
        );
      } catch (error) {
        await rm(normalized.absolutePath, { force: true }).catch(() => {});
        throw error;
      }
      if (!sourceUpdate.rows.length) {
        await rm(normalized.absolutePath, { force: true }).catch(() => {});
        return { stale: true };
      }
      await unlink(normalized.previousAbsolutePath).catch((error) => {
        log?.warn?.({ err: error, mediaId }, "normalized video could not remove its MKV source");
      });
      media = { ...media, file_path: normalized.filePath, mime_type: normalized.mimeType };
      normalizedSource = true;
      log?.info?.({ mediaId, source: normalized.filePath }, "normalized MKV source to MP4");
    }
  } catch (error) {
    log?.warn?.({ err: error, mediaId }, "MKV source normalization failed; preserving the original source");
  }

  const inputPath = join(dataDir, media.file_path);
  const duration = media.duration ?? await probeDuration(inputPath, log);
  const tags = media.mime_type?.startsWith("audio/")
    && (!media.artists || media.track_order == null)
    ? await probeMediaTags(inputPath, log)
    : {};
  const artists = media.artists || tags.artists || null;
  const trackOrder = resolveTrackOrder(media.track_order, tags.trackOrder);
  let thumbnailPath = media.thumbnail_path;

  if (!thumbnailPath && (media.mime_type?.startsWith("video/") || media.mime_type?.startsWith("image/"))) {
    try {
      thumbnailPath = await normalizeMediaCover({
        categoryId: media.category_id,
        mediaId,
        dataDir,
        inputPath,
      });
    } catch (error) {
      log?.warn?.({ err: error, mediaId }, "media finalization could not create item artwork");
    }
  } else if (!media.cover_path && media.mime_type?.startsWith("audio/")) {
    try {
      const coverPath = await normalizeCategoryCover({
        categoryId: media.category_id,
        dataDir,
        inputPath,
      });
      await pg.query(
        "UPDATE categories SET cover_path = $1 WHERE id = $2 AND cover_path IS NULL",
        [coverPath, media.category_id]
      );
    } catch (error) {
      log?.warn?.({ err: error, mediaId }, "media finalization could not create category artwork");
    }
  }

  const updated = await pg.query(
    `UPDATE media_assets
     SET duration = COALESCE($1, duration), artists = $2, track_order = $3, thumbnail_path = $4
     WHERE id = $5 AND source_version = $6
     RETURNING id`,
    [duration, artists, trackOrder, thumbnailPath, mediaId, sourceVersion]
  );
  if (!updated.rows.length) return { stale: true };

  if (normalizedSource) {
    await pg.query(
      `UPDATE media_encoding_variants
       SET status = 'queued', attempts = 0, last_error = NULL, progress_percent = 0, updated_at = NOW()
       WHERE media_id = $1 AND source_version = $2
         AND status IN ('ready', 'skipped', 'failed')`,
      [mediaId, sourceVersion]
    );
  }

  await enqueueEncoding({ pg, redis, mediaId, sourceVersion });
  return { finalized: true };
}

async function ensureGroup(redis) {
  try {
    await redis.xgroup("CREATE", MEDIA_FINALIZATION_STREAM, MEDIA_FINALIZATION_GROUP, "0", "MKSTREAM");
  } catch (error) {
    if (!String(error.message).includes("BUSYGROUP")) throw error;
  }
}

export async function runMediaFinalizationWorker({
  consumer,
  dataDir,
  log,
  maxAttempts = MAX_FINALIZATION_ATTEMPTS,
  pg,
  processJob = processMediaFinalizationJob,
  redis,
  signal,
}) {
  await ensureGroup(redis);
  while (!signal?.aborted) {
    try {
      const reclaimed = await redis.xautoclaim(
        MEDIA_FINALIZATION_STREAM, MEDIA_FINALIZATION_GROUP, consumer, DEFAULT_IDLE_MS, "0-0", "COUNT", 1
      );
      let messages = reclaimed?.[1] || [];
      if (!messages.length) {
        const response = await redis.xreadgroup(
          "GROUP", MEDIA_FINALIZATION_GROUP, consumer, "COUNT", 1, "BLOCK", 5000,
          "STREAMS", MEDIA_FINALIZATION_STREAM, ">"
        );
        messages = response?.[0]?.[1] || [];
      }

      for (const [messageId, rawFields] of messages) {
        const fields = parseStreamFields(rawFields);
        try {
          await processJob({
            dataDir,
            log,
            mediaId: Number(fields.mediaId),
            pg,
            redis,
            sourceVersion: Number(fields.sourceVersion),
          });
          await redis.xack(MEDIA_FINALIZATION_STREAM, MEDIA_FINALIZATION_GROUP, messageId);
        } catch (error) {
          const attempts = await getMessageDeliveryAttempts({
            fields,
            group: MEDIA_FINALIZATION_GROUP,
            messageId,
            redis,
            stream: MEDIA_FINALIZATION_STREAM,
          });

          if (attempts >= maxAttempts) {
            const logFatal = typeof log?.fatal === "function" ? log.fatal.bind(log) : log?.error?.bind(log);
            logFatal?.(
              { attempts, err: error, mediaId: fields.mediaId, messageId, sourceVersion: fields.sourceVersion },
              "media finalization permanently failed after reaching max attempts"
            );
            await redis.xack(MEDIA_FINALIZATION_STREAM, MEDIA_FINALIZATION_GROUP, messageId);
          } else {
            log?.error?.(
              { attempts, err: error, mediaId: fields.mediaId, messageId, sourceVersion: fields.sourceVersion },
              "media finalization failed"
            );
          }
        }
      }
    } catch (error) {
      log?.error?.({ err: error }, "media finalization worker loop failed");
      if (!signal?.aborted) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1000);
          signal?.addEventListener?.("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      }
    }
  }
}
