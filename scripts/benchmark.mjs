import { performance } from "node:perf_hooks";

const baseUrl = (process.env.PFS_BENCHMARK_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const concurrency = 20;
const requestsPerClient = 25;

function percentile(values, ratio) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(Math.floor(ordered.length * ratio), ordered.length - 1)] || 0;
}

async function measure(path, client) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "X-Forwarded-For": `192.168.250.${client + 1}` },
  });
  const body = await response.arrayBuffer();
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return { durationMs: performance.now() - startedAt, bytes: body.byteLength, json: JSON.parse(Buffer.from(body).toString("utf8")) };
}

async function runScenario(name, path, targetP95) {
  const results = (await Promise.all(Array.from({ length: concurrency }, (_, client) => (
    Promise.all(Array.from({ length: requestsPerClient }, () => measure(path, client)))
  )))).flat();
  const durations = results.map((result) => result.durationMs);
  const p95 = percentile(durations, 0.95);
  const averageBytes = Math.round(results.reduce((sum, result) => sum + result.bytes, 0) / results.length);
  console.log(`${name}: p95=${p95.toFixed(1)}ms avgPayload=${averageBytes}B requests=${results.length}`);
  if (p95 > targetP95) process.exitCode = 1;
  return results[0]?.json;
}

const browse = await runScenario("media browse", "/api/media/browse?limit=50", 250);
const queue = await runScenario("queue window", "/api/queue/window?limit=100", 200);

if ((browse?.items?.length || 0) > 100) throw new Error("Browse response exceeded 100 items");
if ((queue?.items?.length || 0) > 100) throw new Error("Queue hydration exceeded 100 items");
if ((queue?.total || 0) < 10_000) console.warn("Queue contains fewer than 10,000 items; seed a large queue for the full target benchmark.");
