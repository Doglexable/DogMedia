import pg from "pg";
import Redis from "ioredis";
import { hostname } from "os";
import { runEncodingWorker } from "./encoding-worker.js";

const dataDir = process.env.DATA_DIR || "data";
const concurrency = Math.max(1, Number.parseInt(process.env.ENCODING_CONCURRENCY || "1", 10));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://pfs:pfs_secret@localhost:5432/pfs" });
const controller = new AbortController();
const workers = Array.from({ length: concurrency }, (_, index) => {
  const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  return { redis, promise: runEncodingWorker({
    dataDir, pg: pool, redis, signal: controller.signal,
    consumer: `${hostname()}-${process.pid}-${index}`,
    log: console,
  }) };
});

async function shutdown() {
  controller.abort();
  await Promise.all(workers.map(({ redis }) => redis.quit().catch(() => {})));
  await pool.end();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await Promise.all(workers.map(({ promise }) => promise));
