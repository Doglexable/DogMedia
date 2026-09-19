export const UPLOAD_COMPLETION_STREAM = "media:upload-completion";
export const UPLOAD_COMPLETION_GROUP = "media-upload-completers";
export const UPLOAD_COMPLETION_STATUS_TTL_SECONDS = 24 * 60 * 60;

export function uploadCompletionStatusKey(uploadId) {
  return `media:upload-completion:${uploadId}`;
}

export async function writeUploadCompletionStatus(redis, uploadId, value) {
  await redis.set(
    uploadCompletionStatusKey(uploadId),
    JSON.stringify(value),
    "EX",
    UPLOAD_COMPLETION_STATUS_TTL_SECONDS
  );
}

export async function enqueueUploadCompletion({ redis, uploadId }) {
  await writeUploadCompletionStatus(redis, uploadId, { status: "queued" });
  try {
    await redis.xadd(UPLOAD_COMPLETION_STREAM, "*", "uploadId", uploadId);
  } catch (error) {
    await redis.del(uploadCompletionStatusKey(uploadId)).catch(() => {});
    throw error;
  }
}
