# Plan 017: Terminate Infinite Retry Loop on Missing Source Files in Encoding Worker

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 50f1f36..HEAD -- server/src/encoding-worker.js server/src/encoding-worker.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/015-fix-site-footer-rgb-tokens.md
- **Category**: bug
- **Planned at**: commit `50f1f36`, 2026-09-22

## Why this matters

When an encoding job is processed for a media asset whose source file is missing from disk, unreadable, or corrupt, `probeSource(inputPath)` throws an exception before the variant loop begins. In `server/src/encoding-worker.js`, the error handling catch block queries `SELECT COALESCE(MAX(attempts), 0) FROM media_encoding_variants`. Because variants were never created or updated, this returns `0`. The worker interprets this as `attempts < 3`, waits a short delay, calls `redis.xadd` to re-enqueue the job, and acknowledges the old message. This causes an infinite busy-loop where the missing file is repeatedly re-enqueued, consuming 100% CPU on the worker thread, spamming logs, and blocking valid encoding jobs. Bounding retries and safely marking failing variants ensures the worker recovers gracefully.

## Current state

The relevant files:
- `server/src/encoding-worker.js` — background consumer for the Redis `media:encoding` stream.
- `server/src/media-finalization-worker.js` — reference exemplar implementing bounded message delivery attempts via `getMessageDeliveryAttempts` and `xack`.

Current-state excerpts:
`server/src/encoding-worker.js:168-174`:
```javascript
  const inputPath = join(dataDir, media.file_path);
  const source = await probeSource(inputPath);
  const { rows: variantRows } = await pg.query(
    "SELECT quality, status FROM media_encoding_variants WHERE media_id = $1 AND source_version = $2",
    [mediaId, sourceVersion]
  );
```

`server/src/encoding-worker.js:211-218`:
```javascript
        onProgress(progressPercent) {
          if (progressPercent < 100 && progressPercent < lastReportedProgress + 2) return;
          lastReportedProgress = progressPercent;
          progressUpdates = progressUpdates.then(() => updateVariantProgress(pg, {
            mediaId, progressPercent, quality, sourceVersion,
          }));
        },
```

`server/src/encoding-worker.js:306-328`:
```javascript
        try {
          await processEncodingJob({ dataDir, log, mediaId, pg, sourceVersion });
          await redis.xack(ENCODING_STREAM, ENCODING_GROUP, messageId);
        } catch (error) {
          const { rows } = await pg.query(
            `SELECT COALESCE(MAX(attempts), 0)::int AS attempts
             FROM media_encoding_variants WHERE media_id = $1 AND source_version = $2`,
            [mediaId, sourceVersion]
          );
          const attempts = Number(rows[0]?.attempts || 0);
          if (attempts >= 3) {
            await redis.xack(ENCODING_STREAM, ENCODING_GROUP, messageId);
          } else {
            await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempts * 1000, 30_000)));
            await pg.query(
              `UPDATE media_encoding_variants SET status = 'queued', progress_percent = 0, updated_at = NOW()
               WHERE media_id = $1 AND source_version = $2 AND status = 'failed'`,
              [mediaId, sourceVersion]
            );
            await redis.xadd(ENCODING_STREAM, "*", "mediaId", String(mediaId), "sourceVersion", String(sourceVersion));
            await redis.xack(ENCODING_STREAM, ENCODING_GROUP, messageId);
          }
        }
```

Repo conventions:
- Follow `server/src/media-finalization-worker.js:195-215` for reading message delivery attempts and permanently acknowledging messages that exceed `maxAttempts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server tests | `npm run test:server` | all pass |
| Encoding tests only | `npm run test:server -- encoding` | all pass |
| Server lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:
- `server/src/encoding-worker.js` — track attempts on stream message or update variants upon failure; add `.catch()` to progress promise chain; permanently acknowledge (`xack`) after 3 attempts.
- `server/src/encoding-worker.test.js` (create or extend) — automated vitest tests for missing source files and retry termination.

**Out of scope**:
- `server/src/media-quality.js` — encoding presets and format resolution logic.
- `server/src/worker.js` — worker process manager.

## Git workflow

- Branch: `advisor/017-encoding-worker-missing-source-retry`
- Commit style: `fix(server): terminate encoding worker retry loop on missing or unreadable source files`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Attach rejection handler to progress updates in `server/src/encoding-worker.js`

In `server/src/encoding-worker.js`, locate `runFfmpegWithProgress` (around lines 207-218). Ensure `progressUpdates` catches and logs any transient database errors:

```javascript
      let progressUpdates = Promise.resolve();
      await runFfmpegWithProgress({
        args: ffmpegArgs({ inputPath, kind, outputPath: temporaryPath, preset: boundedPreset }),
        durationSeconds: source.duration,
        onProgress(progressPercent) {
          if (progressPercent < 100 && progressPercent < lastReportedProgress + 2) return;
          lastReportedProgress = progressPercent;
          progressUpdates = progressUpdates
            .then(() => updateVariantProgress(pg, {
              mediaId, progressPercent, quality, sourceVersion,
            }))
            .catch((err) => {
              log?.warn?.({ err, mediaId, quality }, "failed to update encoding variant progress");
            });
        },
      });
      await progressUpdates.catch(() => {});
```

### Step 2: Track stream message retry attempts and terminate after 3 failures

In `server/src/encoding-worker.js`, update the stream processing loop to track message attempts from the Redis stream message fields or XPENDING info:

```javascript
        const attempts = Number(fields.attempts || 1);
        try {
          await processEncodingJob({ dataDir, log, mediaId, pg, sourceVersion });
          await redis.xack(ENCODING_STREAM, ENCODING_GROUP, messageId);
        } catch (error) {
          log?.error?.({ err: error, mediaId, sourceVersion, attempts }, "encoding job failed");

          if (attempts >= 3) {
            log?.error?.(
              { mediaId, sourceVersion, attempts },
              "encoding permanently failed after reaching max attempts"
            );
            await pg.query(
              `UPDATE media_encoding_variants SET status = 'failed', last_error = $1, updated_at = NOW()
               WHERE media_id = $2 AND source_version = $3 AND status != 'ready'`,
              [error.message || "Encoding failed permanently", mediaId, sourceVersion]
            );
            await redis.xack(ENCODING_STREAM, ENCODING_GROUP, messageId);
          } else {
            await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempts * 1000, 30_000)));
            await pg.query(
              `UPDATE media_encoding_variants SET status = 'queued', progress_percent = 0, updated_at = NOW()
               WHERE media_id = $1 AND source_version = $2 AND status = 'failed'`,
              [mediaId, sourceVersion]
            );
            await redis.xadd(
              ENCODING_STREAM,
              "*",
              "mediaId", String(mediaId),
              "sourceVersion", String(sourceVersion),
              "attempts", String(attempts + 1)
            );
            await redis.xack(ENCODING_STREAM, ENCODING_GROUP, messageId);
          }
        }
```

### Step 3: Write tests in `server/src/encoding-worker.test.js`

Create or add to `server/src/encoding-worker.test.js`:
- Test that when `probeSource` throws an error (e.g. `ENOENT: file not found`), the worker catches the error.
- Test that after 3 attempts, `redis.xack` is called and `redis.xadd` is NOT called, permanently terminating the retry loop.
- Test that variants are marked with `status = 'failed'` in PostgreSQL.

**Verify**: `npm run test:server -- encoding` → all tests pass.

## Test plan

- Verify that jobs failing on initial source probing do not loop infinitely.
- Verify normal jobs still transcode and acknowledge properly.
- Run `npm run test:server` and verify all tests pass.

## Done criteria

- [ ] A missing source file causes at most 3 attempts before being permanently acknowledged with `xack`
- [ ] No infinite re-enqueuing occurs when `probeSource` fails
- [ ] Vitest tests in `server/src/encoding-worker.test.js` pass
- [ ] `npm run lint --workspace=server` exits 0
- [ ] No files outside `server/src/encoding-worker.js` and `server/src/encoding-worker.test.js` are modified

## STOP conditions

- If Redis Stream schema (`media:encoding`) requires fields not supported by `runEncodingWorker`.
- If existing encoding worker tests fail.

## Maintenance notes

- Any additional background workers added to `server/src/worker.js` must pass explicit `attempts` fields in stream payloads to prevent infinite retry loops.
