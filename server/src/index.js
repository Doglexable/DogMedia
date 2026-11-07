import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import postgres from "@fastify/postgres";
import websocket from "@fastify/websocket";
import { join } from "path";

import redisPlugin from "./plugins/redis.js";
import authPlugin from "./plugins/auth.js";
import checkAccessRoutes from "./routes/check-access.js";
import categoriesRoutes from "./routes/categories.js";
import mediaRoutes from "./routes/media.js";
import queueRoutes from "./routes/queue.js";
import playbackRoutes from "./routes/playback.js";
import wrappedRoutes from "./routes/wrapped.js";
import likesRoutes from "./routes/likes.js";
import publicLikedMusicRoutes from "./routes/public-liked-music.js";
import publicMusicShareRoutes from "./routes/public-music-shares.js";
import profilePicturesRoutes from "./routes/profile-pictures.js";
import musicShareRoutes from "./routes/music-shares.js";
import lyricsRoutes from "./routes/lyrics.js";
import subtitlesRoutes from "./routes/subtitles.js";
import offlineRoutes from "./routes/offline.js";
import mobileReleaseRoutes from "./routes/mobile-release.js";
import desktopReleaseRoutes from "./routes/desktop-release.js";
import masterUsersRoutes from "./routes/master-users.js";
import mediaRequestsRoutes from "./routes/media-requests.js";
import contentSignalsRoutes from "./routes/content-signals.js";
import { startOrphanMediaCleanupScheduler } from "./media-cleanup.js";
import { startMusicReelCleanupScheduler } from "./music-reel-cleanup.js";
import { hasActiveUpload, startIncompleteUploadCleanupScheduler } from "./upload-cleanup.js";
import { uploadCompletionStatusKey } from "./upload-completion-queue.js";
import { createPlaybackSocketHub } from "./playback-socket.js";

const DATA_DIR = process.env.DATA_DIR || "data";
const UPLOAD_TMP_DIR = process.env.UPLOAD_TMP_DIR || join(DATA_DIR, "tmp");
const ALLOWED_ORIGINS = new Set(
  String(process.env.PFS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const app = Fastify({
  logger: true,
  trustProxy: process.env.TRUST_PROXY || "127.0.0.1",
});

await app.register(cors, {
  origin(origin, callback) {
    callback(null, !origin || ALLOWED_ORIGINS.has(origin));
  },
  credentials: true,
  allowedHeaders: ["Accept", "Content-Type", "Range", "If-Range", "X-Playback-Session", "X-Playback-Client-ID", "X-Viewer-ID", "X-Client-Platform", "X-Client-Name", "Authorization"],
  exposedHeaders: ["X-Media-Quality", "X-File-Version", "Content-Range"],
});
await app.register(websocket, { options: { maxPayload: 8192 } });
await app.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});
await app.register(postgres, {
  connectionString:
    process.env.DATABASE_URL || "postgres://pfs:pfs_secret@localhost:5432/pfs",
});

const slowQueryMs = Number.parseInt(process.env.SLOW_QUERY_MS || "100", 10);
const originalQuery = app.pg.query.bind(app.pg);
app.pg.query = async (...args) => {
  const startedAt = performance.now();
  try {
    return await originalQuery(...args);
  } finally {
    const durationMs = performance.now() - startedAt;
    if (durationMs >= slowQueryMs) {
      const sql = typeof args[0] === "string" ? args[0] : args[0]?.text;
      app.log.warn({ durationMs: Math.round(durationMs), sql: String(sql || "").slice(0, 240) }, "slow database query");
    }
  }
};

const slowRequestMs = Number.parseInt(process.env.SLOW_REQUEST_MS || "250", 10);
app.addHook("onSend", async (_request, reply) => {
  reply.header("X-Frame-Options", "DENY");
  reply.header("X-Content-Type-Options", "nosniff");
});
app.addHook("onResponse", async (request, reply) => {
  const durationMs = reply.elapsedTime;
  if (durationMs >= slowRequestMs) {
    app.log.warn({
      durationMs: Math.round(durationMs),
      method: request.method,
      route: request.routeOptions?.url || request.url,
      statusCode: reply.statusCode,
      contentLength: reply.getHeader("content-length") || null,
    }, "slow request");
  }
});
if (process.env.RUN_CLEANUP_IN_SERVER === "true") {
  const orphanCleanup = startOrphanMediaCleanupScheduler({
    dataDir: DATA_DIR,
    log: app.log,
    pg: app.pg,
  });
  const reelCleanup = startMusicReelCleanupScheduler({
    dataDir: DATA_DIR,
    log: app.log,
    pg: app.pg,
  });
  app.addHook("onClose", async () => {
    orphanCleanup?.stop();
    reelCleanup?.stop();
  });
}
await redisPlugin(app);
app.decorate("playbackSocketHub", createPlaybackSocketHub(app, { allowedOrigins: ALLOWED_ORIGINS }));
startIncompleteUploadCleanupScheduler({
  log: app.log,
  uploadRoot: join(UPLOAD_TMP_DIR, "chunked"),
  async isActive(uploadId) {
    if (hasActiveUpload(uploadId)) return true;
    try {
      const rawStatus = await app.redis.get(uploadCompletionStatusKey(uploadId));
      const status = rawStatus ? JSON.parse(rawStatus).status : null;
      return status === "queued" || status === "processing";
    } catch (error) {
      app.log.warn({ err: error, uploadId }, "could not check queued upload before cleanup");
      return true;
    }
  },
});
await app.register(publicLikedMusicRoutes, { prefix: "/api/public" });
await app.register(publicMusicShareRoutes, { prefix: "/api/public" });
await app.register(profilePicturesRoutes, { prefix: "/api/profile-pictures", dataDir: DATA_DIR });
await app.register(contentSignalsRoutes);
await app.register(async function (instance) {
  await authPlugin(instance, { allowedOrigins: ALLOWED_ORIGINS });
  await instance.register(checkAccessRoutes);
  await instance.register(categoriesRoutes, { prefix: "/categories" });
  await instance.register(mediaRoutes, { prefix: "/media", allowedOrigins: ALLOWED_ORIGINS });
  await instance.register(musicShareRoutes, { prefix: "/music-shares" });
  await instance.register(queueRoutes, { prefix: "/queue" });
  await instance.register(playbackRoutes, { prefix: "/playback" });
  await instance.register(wrappedRoutes, { prefix: "/wrapped" });
  await instance.register(likesRoutes, { prefix: "/likes" });
  await instance.register(lyricsRoutes);
  await instance.register(subtitlesRoutes);
  await instance.register(offlineRoutes, { prefix: "/offline" });
  await instance.register(mobileReleaseRoutes, { prefix: "/mobile-release" });
  await instance.register(desktopReleaseRoutes, { prefix: "/desktop-release" });
  await instance.register(masterUsersRoutes, { prefix: "/master/users" });
  await instance.register(mediaRequestsRoutes, { prefix: "/media-requests" });
}, { prefix: "/api" });

const port = parseInt(process.env.PORT || "3001", 10);
const host = process.env.HOST || "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
