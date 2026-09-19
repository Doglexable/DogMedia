import * as fs from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_INCOMPLETE_UPLOAD_MAX_IDLE_MS,
  cleanupIncompleteUploads,
  getIncompleteUploadCleanupConfig,
  withActiveUpload,
} from "./upload-cleanup.js";

let roots = [];

async function makeRoot() {
  const root = await fs.mkdtemp(join(tmpdir(), "pfs-upload-cleanup-"));
  roots.push(root);
  return root;
}

async function makeSession(root, uploadId, mtime) {
  const session = join(root, uploadId);
  await fs.mkdir(session);
  await fs.writeFile(join(session, "manifest.json"), "{}");
  await fs.utimes(session, mtime, mtime);
  return session;
}

async function exists(path) {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
  roots = [];
});

describe("incomplete upload cleanup", () => {
  it("deletes UUID upload sessions idle for 30 minutes and keeps recent sessions", async () => {
    const root = await makeRoot();
    const stale = await makeSession(root, "11111111-1111-4111-8111-111111111111", new Date("2026-09-20T00:00:00Z"));
    const recent = await makeSession(root, "22222222-2222-4222-8222-222222222222", new Date("2026-09-20T00:20:01Z"));

    const summary = await cleanupIncompleteUploads({
      now: new Date("2026-09-20T00:30:00Z").getTime(),
      uploadRoot: root,
    });

    expect(await exists(stale)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(summary).toMatchObject({ scanned: 2, deleted: 1, errors: 0 });
  });

  it("never removes a session while a chunk or completion request is active", async () => {
    const root = await makeRoot();
    const uploadId = "33333333-3333-4333-8333-333333333333";
    const session = await makeSession(root, uploadId, new Date("2026-09-20T00:00:00Z"));

    await withActiveUpload(uploadId, async () => {
      const summary = await cleanupIncompleteUploads({
        now: new Date("2026-09-20T01:00:00Z").getTime(),
        uploadRoot: root,
      });
      expect(summary.active).toBe(1);
      expect(await exists(session)).toBe(true);
    });
  });

  it("uses a 30-minute default and accepts environment overrides", () => {
    expect(getIncompleteUploadCleanupConfig({}).maxIdleMs).toBe(DEFAULT_INCOMPLETE_UPLOAD_MAX_IDLE_MS);
    expect(getIncompleteUploadCleanupConfig({
      INCOMPLETE_UPLOAD_CLEANUP_ENABLED: "false",
      INCOMPLETE_UPLOAD_CLEANUP_INTERVAL_MS: "1000",
      INCOMPLETE_UPLOAD_MAX_IDLE_MS: "2000",
    })).toEqual({ enabled: false, intervalMs: 1000, maxIdleMs: 2000 });
  });
});
