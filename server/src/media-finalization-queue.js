export const MEDIA_FINALIZATION_STREAM = "media:finalization";
export const MEDIA_FINALIZATION_GROUP = "media-finalizers";

export async function enqueueMediaFinalization({ redis, mediaId, sourceVersion }) {
  if (typeof redis?.xadd === "function") {
    await redis.xadd(
      MEDIA_FINALIZATION_STREAM,
      "*",
      "mediaId", String(mediaId),
      "sourceVersion", String(sourceVersion)
    );
  }
}
