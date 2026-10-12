# Plan 062: Expire abandoned Android release uploads

> **Executor instructions**: Follow this plan step by step. Run each
> verification command and confirm its expected result before moving on. Stop
> at any STOP condition rather than deleting files outside the release staging
> directory.
>
> **Drift check (run first)**: `git diff --stat c26a4d4..HEAD -- server/src/index.js server/src/upload-cleanup.js server/src/upload-cleanup.test.js server/src/routes/mobile-release.js server/src/routes/mobile-release.test.js .env.example`
> If an in-scope file changed after this plan was written, compare the current
> state below with the live code before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: reliability / tech-debt
- **Planned at**: commit `c26a4d4`, 2026-10-12

## Why this matters

The Android release endpoint stages chunks under `DATA_DIR/mobile-release/uploads/<uuid>`.
Successful completion and explicit client cancellation remove the directory,
but a browser or device that disappears cannot send the cancellation request.
Those chunks have no server-side expiry and can accumulate in the persistent
data volume. Reuse the existing incomplete-upload cleanup mechanism so stale
release staging is bounded and active work is protected.

## Current state

- `server/src/routes/mobile-release.js` creates a UUID directory and manifest
  in `POST /uploads`, writes chunk files in `POST /uploads/:uploadId/chunks`,
  and removes the directory only after successful completion or DELETE.
- `server/src/upload-cleanup.js` scans UUID directories, skips active uploads,
  removes sessions older than the configured idle age, and provides an
  unref'ed startup/interval scheduler.
- `server/src/index.js` starts that scheduler for
  `UPLOAD_TMP_DIR/chunked` and calls `hasActiveUpload` before removal.
- `server/src/routes/media.js` uses `withActiveUpload(uploadId, operation)` to
  prevent cleanup from deleting a media upload while a request is using it.
- `.env.example` documents a 30 minute idle threshold and 5 minute cleanup
  interval. The same thresholds are suitable for release chunks, but
  overwriting an existing chunk file may not refresh the staging directory's
  modification time. Explicitly refresh it after every successful chunk write.
- `server/src/upload-cleanup.test.js` uses temporary directories and injected
  clock/active-state functions. `server/src/routes/mobile-release.test.js`
  is the route test pattern.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Route tests | `npm run test:server -- mobile-release.test.js` | release route tests pass |
| Cleanup tests | `npm run test:server -- upload-cleanup.test.js` | cleanup tests pass |
| Full server suite | `npm run test:server` | all server tests pass |
| Lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:

- `server/src/index.js`
- `server/src/routes/mobile-release.js`
- `server/src/routes/mobile-release.test.js`
- `server/src/upload-cleanup.js` and `server/src/upload-cleanup.test.js` only if
  the existing helper needs a small generalization
- `.env.example`
- `plans/README.md` (status only)

**Out of scope**:

- `server/src/routes/media.js` upload semantics and media cleanup policy.
- Published APK files, release metadata, and the configured release filename.
- Adding a separate janitor implementation or a second cleanup algorithm.

## Git workflow

- Branch: `advisor/062-expire-abandoned-mobile-release-uploads`
- Commit style: `fix(server): expire abandoned mobile release uploads`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Track active release upload operations

Wrap chunk writes and the complete operation in the existing
`withActiveUpload(uploadId, async () => ...)` helper. Keep the validation and
HTTP responses unchanged. After each successful chunk write, use
`utimes(uploadDir, now, now)` so a retry that overwrites an existing chunk
counts as recent activity. The active guard protects long chunk writes and APK
assembly from the scheduled cleanup pass. Follow the existing media upload
guard pattern without changing media routes.

**Verify**: `npm run test:server -- mobile-release.test.js` → existing route
tests pass, including chunk completion and invalid-index handling.

### Step 2: Run cleanup against the release staging root

In `server/src/index.js`, start the existing incomplete-upload scheduler for
`join(DATA_DIR, "mobile-release", "uploads")`, using `hasActiveUpload` as its
active predicate and the existing cleanup interval / idle threshold. Do not
change the current media upload scheduler's root or behavior. Update
`.env.example`'s comment to say the existing idle setting also applies to
incomplete Android release uploads. Keep cleanup limited to UUID directories
inside that root.

**Verify**: `npm run test:server -- upload-cleanup.test.js` → stale directories
are removed, fresh and active directories remain, and missing roots are safe.

### Step 3: Add regression coverage for the release staging lifecycle

Add a cleanup test that creates a release staging directory with an old mtime
and a fresh sibling, invokes the shared cleanup function with a controlled
`now` and `maxIdleMs`, then confirms only the old inactive UUID directory is
removed. Add a route-level test or helper assertion proving a currently active
release upload is reported active to cleanup while its chunk/complete request
is running. Add a route test that sets the staging directory mtime to old,
reuploads an already present chunk index, and confirms the mtime becomes
recent after the write. Use the existing temporary-directory test patterns.

**Verify**: `npm run test:server` → all server tests pass.

## Test plan

- Add deterministic tests for stale, fresh, and active staging directories.
- Confirm an overwritten chunk refreshes the release staging directory mtime.
- Keep existing upload success, failure, and explicit DELETE tests passing.
- Model cleanup tests after `server/src/upload-cleanup.test.js` and route tests
  after `server/src/routes/mobile-release.test.js`.

## Done criteria

- [ ] A stale abandoned release UUID directory is removed after the configured
  idle age.
- [ ] Fresh and active release upload directories are preserved.
- [ ] A retry that overwrites an existing chunk refreshes the idle clock.
- [ ] The existing media upload cleanup still targets only its current root.
- [ ] `npm run test:server` and `npm run lint --workspace=server` exit 0.
- [ ] No unrelated upload or published release files are touched.
- [ ] The Plan 062 status row in `plans/README.md` is updated.

## STOP conditions

- Stop if the cleanup helper cannot be safely reused without changing media
  upload behavior.
- Stop if release upload directories do not have UUID names or an explicit
  directory timestamp refresh fails after a successful chunk write.
- Stop if the active guard cannot be applied to both chunk writes and APK
  completion without changing response behavior; do not solve this by
  weakening the idle threshold.

## Maintenance notes

Release staging lives beside the published APK but under its own `uploads/`
root. Keep the janitor restricted to that directory. If release uploads later
become asynchronous, include their queued/processing state in the active
predicate just as media uploads do.
