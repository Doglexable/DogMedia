# Plan 004: Prevent Infinite Retry Loops in Media Finalization Worker

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- server/src/media-finalization-worker.js server/src/media-finalization-worker.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

In `server/src/media-finalization-worker.js:147-162`, when `processMediaFinalizationJob` throws an error (e.g. invalid media file, probe failure, corrupt audio tags), the worker catches the error, logs it, and continues. Critically, it **never calls `redis.xack`** for the failed message.

Every 60 seconds, `redis.xautoclaim` reclaims this unacknowledged message and attempts to re-process it. This creates an infinite retry loop that spams error logs, wastes disk I/O and CPU, and permanently clogs the finalization consumer group.

Fixing this by tracking retry attempts or dead-lettering/acknowledging failed jobs ensures the worker can recover cleanly from corrupted uploads.

## Current state

- `server/src/media-finalization-worker.js:147-162`:
```javascript
      for (const [messageId, rawFields] of messages) {
        const fields = parseStreamFields(rawFields);
        try {
          await processMediaFinalizationJob({
            dataDir,
            log,
            mediaId: Number(fields.mediaId),
            pg,
            redis,
            sourceVersion: Number(fields.sourceVersion),
          });
          await redis.xack(MEDIA_FINALIZATION_STREAM, MEDIA_FINALIZATION_GROUP, messageId);
        } catch (error) {
          log?.error?.({ err: error, mediaId: fields.mediaId }, "media finalization failed");
        }
      }
```

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `npm run test:server`    | exit 0, all pass    |
| Lint      | `npm run lint --workspace=server` | exit 0     |

## Scope

**In scope**:
- `server/src/media-finalization-worker.js`
- `server/src/media-finalization-worker.test.js`

**Out of scope**:
- Video encoding queue worker (`encoding-worker.js`).

## Git workflow

- Branch: `advisor/004-finalization-worker-retry`
- Commit message: `fix(worker): handle failed jobs and prevent infinite retry in finalization worker`

## Steps

### Step 1: Add Retry Attempt Limit and Acknowledgment on Terminal Failure

In `server/src/media-finalization-worker.js`:
1. Use Redis message delivery counter (via `xpending` or message field `attempts`) with a maximum threshold (e.g. `MAX_FINALIZATION_ATTEMPTS = 3`).
2. When a job fails:
   - Check attempt count. If attempts >= `MAX_FINALIZATION_ATTEMPTS`, log a fatal error, optionally record a failure state in the database, and call `redis.xack(MEDIA_FINALIZATION_STREAM, MEDIA_FINALIZATION_GROUP, messageId)` so the poisoned message is removed from the stream.

### Step 2: Add Worker Failure Test

In `server/src/media-finalization-worker.test.js`:
- Add a test verifying that when `processMediaFinalizationJob` repeatedly fails, the message is eventually acknowledged (`xack`) after exceeding max attempts rather than left unacknowledged forever.

## Done criteria

- [ ] `npm run lint --workspace=server` exits 0.
- [ ] `npm run test:server` exits 0 with new test passing.
- [ ] Corrupted finalization jobs do not retry infinitely.

## STOP conditions

- If database schema requires new columns for finalization failure status, report before adding migrations.
