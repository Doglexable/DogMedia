import * as defaultFs from "fs/promises";
import { join } from "path";

export const DEFAULT_INCOMPLETE_UPLOAD_MAX_IDLE_MS = 30 * 60 * 1000;
export const DEFAULT_INCOMPLETE_UPLOAD_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const UPLOAD_ID_RE = /^[0-9a-f-]{36}$/i;
const activeUploads = new Map();

export function hasActiveUpload(uploadId) {
  return activeUploads.has(uploadId);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getIncompleteUploadCleanupConfig(env = process.env) {
  return {
    enabled: env.INCOMPLETE_UPLOAD_CLEANUP_ENABLED !== "false",
    intervalMs: parsePositiveInt(
      env.INCOMPLETE_UPLOAD_CLEANUP_INTERVAL_MS,
      DEFAULT_INCOMPLETE_UPLOAD_CLEANUP_INTERVAL_MS
    ),
    maxIdleMs: parsePositiveInt(
      env.INCOMPLETE_UPLOAD_MAX_IDLE_MS,
      DEFAULT_INCOMPLETE_UPLOAD_MAX_IDLE_MS
    ),
  };
}

export async function withActiveUpload(uploadId, operation) {
  activeUploads.set(uploadId, (activeUploads.get(uploadId) || 0) + 1);
  try {
    return await operation();
  } finally {
    const remaining = (activeUploads.get(uploadId) || 1) - 1;
    if (remaining > 0) activeUploads.set(uploadId, remaining);
    else activeUploads.delete(uploadId);
  }
}

export async function cleanupIncompleteUploads({
  fs = defaultFs,
  isActive = hasActiveUpload,
  log,
  maxIdleMs = DEFAULT_INCOMPLETE_UPLOAD_MAX_IDLE_MS,
  now = Date.now(),
  uploadRoot,
}) {
  const summary = { scanned: 0, deleted: 0, active: 0, skipped: 0, errors: 0 };
  let entries;
  try {
    entries = await fs.readdir(uploadRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return summary;
    summary.errors += 1;
    log?.warn?.({ err: error, uploadRoot }, "incomplete upload cleanup could not scan upload directory");
    return summary;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !UPLOAD_ID_RE.test(entry.name)) {
      summary.skipped += 1;
      continue;
    }

    summary.scanned += 1;
    if (await isActive(entry.name)) {
      summary.active += 1;
      continue;
    }

    const sessionPath = join(uploadRoot, entry.name);
    try {
      const sessionStat = await fs.stat(sessionPath);
      if (now - sessionStat.mtimeMs < maxIdleMs) {
        summary.skipped += 1;
        continue;
      }
      await fs.rm(sessionPath, { recursive: true, force: true });
      summary.deleted += 1;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        summary.errors += 1;
        log?.warn?.({ err: error, uploadId: entry.name }, "incomplete upload cleanup could not delete session");
      }
    }
  }

  if (summary.deleted || summary.errors) {
    log?.info?.(summary, "incomplete upload cleanup finished");
  }
  return summary;
}

export function startIncompleteUploadCleanupScheduler({
  cleanup = cleanupIncompleteUploads,
  env = process.env,
  isActive,
  log,
  uploadRoot,
}) {
  const config = getIncompleteUploadCleanupConfig(env);
  if (!config.enabled) {
    log?.info?.("incomplete upload cleanup disabled");
    return null;
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await cleanup({ isActive, log, maxIdleMs: config.maxIdleMs, uploadRoot });
    } catch (error) {
      log?.warn?.({ err: error }, "incomplete upload cleanup failed");
    } finally {
      running = false;
    }
  };

  const startupTimer = setTimeout(run, 1000);
  startupTimer.unref?.();
  const intervalTimer = setInterval(run, config.intervalMs);
  intervalTimer.unref?.();

  return {
    run,
    stop() {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
