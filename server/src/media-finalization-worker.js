import { join } from "path";
import { normalizeCategoryCover, normalizeMediaCover } from "./category-cover.js";
import { enqueueEncoding } from "./encoding-queue.js";
import { parseStreamFields } from "./encoding-worker.js";
import { MEDIA_FINALIZATION_GROUP, MEDIA_FINALIZATION_STREAM } from "./media-finalization-queue.js";
import { probeDuration, probeMediaTags, resolveTrackOrder } from "./routes/media.js";

const DEFAULT_IDLE_MS = 60_000;

export async function processMediaFinalizationJob({ dataDir, log, mediaId, pg, redis, sourceVersion }) {
  const { rows } = await pg.query(
    `SELECT m.*, c.cover_path
     FROM media_assets m
     JOIN categories c ON c.id = m.category_id
     WHERE m.id = $1`,
    [mediaId]
  );
  const media = rows[0];
  if (!media || Number(media.source_version) !== Number(sourceVersion)) return { stale: true };

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

export async function runMediaFinalizationWorker({ consumer, dataDir, log, pg, redis, signal }) {
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
          await processMediaFinalizationJob({
            dataDir,
            log,
            mediaId: Number(fields.mediaId),
            pg,
            redis,
            sourceVersion: Number(fields.sourceVersion),
          });
          await redis.xack(MEDIA_FINALIZATION_STREAM, MEDIA_FINALIZATION_GROUP, messageId);
        } catch (error) {
          log?.error?.({ err: error, mediaId: fields.mediaId }, "media finalization failed");
        }
      }
    } catch (error) {
      log?.error?.({ err: error }, "media finalization worker loop failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
