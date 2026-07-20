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

const app = Fastify({
  logger: true,
  trustProxy: process.env.TRUST_PROXY || "127.0.0.1",
});

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: {
    fileSize: 1024 * 1024,
  },
});
await app.register(postgres, {
  connectionString:
    process.env.DATABASE_URL || "postgres://pfs:pfs_secret@localhost:5432/pfs",
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
}, { prefix: "/api" });

const port = parseInt(process.env.PORT || "3001", 10);
const host = process.env.HOST || "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
