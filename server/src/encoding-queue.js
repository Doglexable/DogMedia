import { ENCODED_QUALITIES } from "./media-quality.js";

export const ENCODING_STREAM = "media:encoding";
export const ENCODING_GROUP = "media-encoders";

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

export async function retryFailedEncoding({ pg, redis, mediaId }) {
  const { rows } = await pg.query(
    `UPDATE media_encoding_variants v
     SET status = 'queued', attempts = 0, last_error = NULL, progress_percent = 0, updated_at = NOW()
     FROM media_assets m
     WHERE v.media_id = m.id AND v.media_id = $1
       AND v.source_version = m.source_version AND v.status = 'failed'
     RETURNING v.source_version`,
    [mediaId]
  );
  if (!rows.length) return false;
  if (typeof redis?.xadd === "function") {
    await redis.xadd(ENCODING_STREAM, "*", "mediaId", String(mediaId), "sourceVersion", String(rows[0].source_version));
  }
  return true;
}
