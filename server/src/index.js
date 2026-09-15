import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import postgres from "@fastify/postgres";

import redisPlugin from "./plugins/redis.js";
import authPlugin from "./plugins/auth.js";
import checkAccessRoutes from "./routes/check-access.js";
import categoriesRoutes from "./routes/categories.js";
import mediaRoutes from "./routes/media.js";
import whitelistRoutes from "./routes/whitelist.js";
import queueRoutes from "./routes/queue.js";
import playbackRoutes from "./routes/playback.js";
import wrappedRoutes from "./routes/wrapped.js";
import likesRoutes from "./routes/likes.js";
import publicLikedMusicRoutes from "./routes/public-liked-music.js";
import lyricsRoutes from "./routes/lyrics.js";
import offlineRoutes from "./routes/offline.js";
import mobileReleaseRoutes from "./routes/mobile-release.js";
import { startOrphanMediaCleanupScheduler } from "./media-cleanup.js";

const DATA_DIR = process.env.DATA_DIR || "data";

const app = Fastify({
  logger: true,
  trustProxy: process.env.TRUST_PROXY || "127.0.0.1",
});

await app.register(cors, {
  origin: true,
  exposedHeaders: ["X-Media-Quality", "X-File-Version", "Content-Range"],
});
await app.register(multipart, {
  limits: {
    fileSize: 1024 * 1024,
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
startOrphanMediaCleanupScheduler({
  dataDir: DATA_DIR,
  log: app.log,
  pg: app.pg,
});

await redisPlugin(app);
await app.register(publicLikedMusicRoutes, { prefix: "/api/public" });
await app.register(async function (instance) {
  await authPlugin(instance);
  await instance.register(checkAccessRoutes);
  await instance.register(categoriesRoutes, { prefix: "/categories" });
  await instance.register(mediaRoutes, { prefix: "/media" });
  await instance.register(whitelistRoutes, { prefix: "/whitelist" });
  await instance.register(queueRoutes, { prefix: "/queue" });
  await instance.register(playbackRoutes, { prefix: "/playback" });
  await instance.register(wrappedRoutes, { prefix: "/wrapped" });
  await instance.register(likesRoutes, { prefix: "/likes" });
  await instance.register(lyricsRoutes);
  await instance.register(offlineRoutes, { prefix: "/offline" });
  await instance.register(mobileReleaseRoutes, { prefix: "/mobile-release" });
}, { prefix: "/api" });

const port = parseInt(process.env.PORT || "3001", 10);
const host = process.env.HOST || "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
