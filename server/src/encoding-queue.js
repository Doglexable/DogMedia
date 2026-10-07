import { ENCODED_QUALITIES } from "./media-quality.js";

export const ENCODING_STREAM = "media:encoding";
export const ENCODING_GROUP = "media-encoders";
export const URGENT_ENCODING_STREAM = "media:encoding:urgent";
export const URGENT_ENCODING_GROUP = "media-encoders-urgent";

async function enqueueQuality({ pg, redis, mediaId, sourceVersion, quality }) {
  if (!ENCODED_QUALITIES.includes(quality)) throw new Error(`Unsupported encoding quality: ${quality}`);
  const { rows } = await pg.query(
    `WITH inserted AS (
       INSERT INTO media_encoding_variants (media_id, source_version, quality, status)
       VALUES ($1, $2, $3, 'queued')
       ON CONFLICT (media_id, quality, source_version) DO NOTHING
       RETURNING quality
     ), reset AS (
       UPDATE media_encoding_variants
       SET status = 'queued', attempts = 0, last_error = NULL, progress_percent = 0, updated_at = NOW()
       WHERE media_id = $1 AND source_version = $2 AND quality = $3 AND status = 'failed'
         AND NOT EXISTS (SELECT 1 FROM inserted)
       RETURNING quality
     ) SELECT quality FROM inserted UNION ALL SELECT quality FROM reset`,
    [mediaId, sourceVersion, quality]
  );
  if (!rows.length) return false;
  if (typeof redis?.xadd === "function") {
    await redis.xadd(URGENT_ENCODING_STREAM, "*", "mediaId", String(mediaId), "sourceVersion", String(sourceVersion), "quality", quality);
  }
  return true;
}

export async function enqueueEncodingQuality(args) {
  return enqueueQuality(args);
}

export async function enqueueEncoding({ pg, redis, mediaId, sourceVersion }) {
  await pg.query(
    `INSERT INTO media_encoding_variants (media_id, source_version, quality, status)
     SELECT $1, $2, quality, 'queued'
     FROM unnest($3::text[]) AS quality
     ON CONFLICT (media_id, quality, source_version)
     DO NOTHING`,
    [mediaId, sourceVersion, ENCODED_QUALITIES]
  );
  if (typeof redis?.xadd === "function") {
    await redis.xadd(ENCODING_STREAM, "*", "mediaId", String(mediaId), "sourceVersion", String(sourceVersion));
  }
}

export async function retryFailedEncoding({ pg, redis, mediaId, force = false }) {
  const { rows } = await pg.query(
    `UPDATE media_encoding_variants v
     SET status = 'queued', attempts = 0, last_error = NULL, progress_percent = 0, updated_at = NOW()
     FROM media_assets m
     WHERE v.media_id = m.id AND v.media_id = $1
       AND v.source_version = m.source_version
       AND (v.status = 'failed' OR ($2::boolean AND v.status IN ('ready', 'skipped')))
     RETURNING v.source_version`,
    [mediaId, force]
  );
  if (!rows.length) return false;
  if (typeof redis?.xadd === "function") {
    await redis.xadd(ENCODING_STREAM, "*", "mediaId", String(mediaId), "sourceVersion", String(rows[0].source_version));
  }
  return true;
}
