import Redis from "ioredis";

export default async function (fastify) {
  const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

  redis.on("error", (err) => {
    fastify.log.error({ err }, "Redis connection error");
  });

  redis.on("connect", () => {
    fastify.log.info("Connected to Redis");
  });

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async () => {
    await redis.quit();
  });
}
