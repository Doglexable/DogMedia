import { parseStreamFields } from "./encoding-worker.js";
import { processChunkedMediaUpload } from "./routes/media.js";
import {
  UPLOAD_COMPLETION_GROUP,
  UPLOAD_COMPLETION_STREAM,
  writeUploadCompletionStatus,
} from "./upload-completion-queue.js";

const DEFAULT_IDLE_MS = 60_000;

async function ensureGroup(redis) {
  try {
    await redis.xgroup("CREATE", UPLOAD_COMPLETION_STREAM, UPLOAD_COMPLETION_GROUP, "0", "MKSTREAM");
  } catch (error) {
    if (!String(error.message).includes("BUSYGROUP")) throw error;
  }
}

export async function processUploadCompletionJob({ fastify, log, redis, uploadId }) {
  await writeUploadCompletionStatus(redis, uploadId, { status: "processing" });
  try {
    const media = await processChunkedMediaUpload({ fastify, log, uploadId });
    await writeUploadCompletionStatus(redis, uploadId, { status: "completed", media });
    return media;
  } catch (error) {
    await writeUploadCompletionStatus(redis, uploadId, {
      status: "failed",
      error: String(error?.message || error).slice(0, 1000),
    });
    throw error;
  }
}

export async function runUploadCompletionWorker({ consumer, fastify, log, redis, signal }) {
  await ensureGroup(redis);
  while (!signal?.aborted) {
    try {
      const reclaimed = await redis.xautoclaim(
        UPLOAD_COMPLETION_STREAM, UPLOAD_COMPLETION_GROUP, consumer, DEFAULT_IDLE_MS, "0-0", "COUNT", 1
      );
      let messages = reclaimed?.[1] || [];
      if (!messages.length) {
        const response = await redis.xreadgroup(
          "GROUP", UPLOAD_COMPLETION_GROUP, consumer, "COUNT", 1, "BLOCK", 5000,
          "STREAMS", UPLOAD_COMPLETION_STREAM, ">"
        );
        messages = response?.[0]?.[1] || [];
      }

      for (const [messageId, rawFields] of messages) {
        const { uploadId } = parseStreamFields(rawFields);
        try {
          await processUploadCompletionJob({ fastify, log, redis, uploadId });
        } catch (error) {
          log?.error?.({ err: error, uploadId }, "upload completion failed");
        } finally {
          await redis.xack(UPLOAD_COMPLETION_STREAM, UPLOAD_COMPLETION_GROUP, messageId);
        }
      }
    } catch (error) {
      log?.error?.({ err: error }, "upload completion worker loop failed");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
