export const UPLOAD_COMPLETION_STREAM = "media:upload-completion";
export const UPLOAD_COMPLETION_GROUP = "media-upload-completers";
export const UPLOAD_COMPLETION_STATUS_TTL_SECONDS = 24 * 60 * 60;
export const UPLOAD_COMPLETION_STATUS_PREFIX = "media:upload-completion:";

export function uploadCompletionStatusKey(uploadId) {
  return `${UPLOAD_COMPLETION_STATUS_PREFIX}${uploadId}`;
}

export async function writeUploadCompletionStatus(redis, uploadId, value) {
  const key = uploadCompletionStatusKey(uploadId);
  let previous = {};
  try {
    const raw = await redis.get(key);
    if (raw) previous = JSON.parse(raw);
  } catch {
    // A malformed or missing previous value should not prevent status updates.
  }
  const now = new Date().toISOString();
  const next = {
    ...previous,
    uploadId,
    ...value,
    updatedAt: now,
  };
  if (value.status === "queued" && !next.queuedAt) next.queuedAt = now;
  if (value.status === "processing" && !next.startedAt) next.startedAt = now;
  if (["completed", "failed"].includes(value.status) && !next.finishedAt) next.finishedAt = now;
  await redis.set(
    key,
    JSON.stringify(next),
    "EX",
    UPLOAD_COMPLETION_STATUS_TTL_SECONDS
  );
  return next;
}

export async function enqueueUploadCompletion({ redis, uploadId, metadata = {} }) {
  await writeUploadCompletionStatus(redis, uploadId, { status: "queued", ...metadata });
  try {
    await redis.xadd(UPLOAD_COMPLETION_STREAM, "*", "uploadId", uploadId);
  } catch (error) {
    await redis.del(uploadCompletionStatusKey(uploadId)).catch(() => {});
    throw error;
  }
}
