# Plan 010: Prevent Duplicate Concurrent Execution of Background Cleanup Schedulers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- server/src/index.js server/src/worker.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

In `server/src/index.js:88-97` and `server/src/worker.js:63-72`, both the web API server process and the background worker process unconditionally start `startOrphanMediaCleanupScheduler` and `startMusicReelCleanupScheduler`. When running under `compose.yml`, both containers execute against the same shared database and storage volume simultaneously.

Without distributed locks, two independent Node.js processes perform uncoordinated disk scans and deletions on identical schedules, causing I/O contention and redundant database queries.

Designating `worker.js` as the sole owner of scheduled background tasks (or guarding startup with an environment flag) eliminates duplicate runs.

## Current state

- `server/src/index.js:88-97`:
```javascript
startOrphanMediaCleanupScheduler({
  dataDir: DATA_DIR,
  log: app.log,
  pg: app.pg,
});
startMusicReelCleanupScheduler({
  dataDir: DATA_DIR,
  log: app.log,
  pg: app.pg,
});
```
- `server/src/worker.js:63-72`:
```javascript
const orphanCleanup = startOrphanMediaCleanupScheduler({
  dataDir,
  log: console,
  pg: pool,
});
const reelCleanup = startMusicReelCleanupScheduler({
  dataDir,
  log: console,
  pg: pool,
});
```

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `npm run test:server`    | exit 0, all pass    |
| Lint      | `npm run lint --workspace=server` | exit 0     |

## Scope

**In scope**:
- `server/src/index.js`
- `server/src/worker.js`

**Out of scope**:
- Cleanup business logic in `server/src/media-cleanup.js`.

## Git workflow

- Branch: `advisor/010-deduplicate-cleanup-schedulers`
- Commit message: `fix(server): designate background worker as sole cleanup scheduler host`

## Steps

### Step 1: Guard or Remove Cleanup Schedulers from HTTP API Server

In `server/src/index.js`:
- Only start orphan and reel cleanups if `process.env.RUN_CLEANUP_IN_SERVER === "true"`, defaulting to `false` when a dedicated worker service is present.
- Keep `worker.js` as the canonical daemon for background maintenance tasks.

### Step 2: Verify

Run `npm run test:server` and `npm run lint --workspace=server`.

## Done criteria

- [ ] `npm run lint --workspace=server` exits 0.
- [ ] `npm run test:server` exits 0.
- [ ] Concurrent processes do not run duplicate uncoordinated cleanups by default.
