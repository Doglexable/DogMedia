# Plan 022: Implement Automated Test Suite for Mobile SQLite Offline Store

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 50f1f36..HEAD -- mobile/src/offline-store.js mobile/src/offline-store.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/015-fix-site-footer-rgb-tokens.md
- **Category**: tests
- **Planned at**: commit `50f1f36`, 2026-09-22

## Why this matters

The mobile offline streaming engine relies on SQLite (`expo-sqlite`) to persist offline leases, download file metadata, download queue jobs, playback telemetry events outbox, and dirty local resumes across app launches. Currently, `mobile/src/utils/offline.test.js` only tests pure string/math calculation helpers, leaving the entire database persistence layer (`mobile/src/offline-store.js`) completely untested. Any bugs in outbox event purging, resume conflict resolution, download status transitions, or SQLite schema initialization fail silently on devices. Adding a comprehensive test suite for `offline-store.js` guarantees data persistence integrity.

## Current state

The relevant files:
- `mobile/src/offline-store.js` — SQLite database manager for offline state (5 tables: `offline_lease`, `downloads`, `download_jobs`, `playback_outbox`, `local_resumes`).
- `mobile/src/utils/offline.test.js` — existing unit tests covering calculation helpers only.

Current-state excerpts:
`mobile/src/offline-store.js:22-35`:
```javascript
export async function getOfflineDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync("dogmedia-offline.db").then(async (database) => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS offline_lease (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          expires_at TEXT,
          locked INTEGER NOT NULL DEFAULT 0,
          validated_at TEXT
        );
```

`mobile/src/offline-store.js:75-88`:
```javascript
export async function getStoredLease() {
  const database = await getOfflineDatabase();
  const row = await database.getFirstAsync("SELECT expires_at, locked, validated_at FROM offline_lease WHERE id = 1");
  return row ? { expiresAt: row.expires_at, locked: Boolean(row.locked), validatedAt: row.validated_at } : null;
}

export async function saveStoredLease({ expiresAt, locked = false, validatedAt = new Date().toISOString() }) {
  const database = await getOfflineDatabase();
  await database.runAsync(
    `INSERT INTO offline_lease (id, expires_at, locked, validated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET expires_at = excluded.expires_at, locked = excluded.locked, validated_at = excluded.validated_at`,
    expiresAt || null, locked ? 1 : 0, validatedAt
  );
}
```

Repo conventions:
- Vitest with `vi.mock` for native React Native/Expo modules.
- Model mocking patterns in `mobile/src/api.test.js`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Mobile tests | `npm run test:mobile` | all pass |
| Offline store test only | `npm run test:mobile -- offline-store.test.js` | all pass |
| Mobile lint | `npm run lint --workspace=mobile` | exit 0 |

## Scope

**In scope**:
- `mobile/src/offline-store.test.js` (create) — vitest suite covering `offline-store.js` operations.
- `mobile/src/offline-store.js` — export database reset helper or accept database injection if needed for clean test isolation.

**Out of scope**:
- UI components in `mobile/src/screens/`.
- Backend offline routes in `server/src/routes/offline.js`.

## Git workflow

- Branch: `advisor/022-mobile-offline-sync-test-suite`
- Commit style: `test(mobile): add comprehensive test suite for SQLite offline store`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Export a database reset helper in `mobile/src/offline-store.js`

Open `mobile/src/offline-store.js`. Export a function allowing tests to reset or inject the database handle between test cases:
```javascript
export function _resetOfflineDatabaseForTesting() {
  databasePromise = null;
}
```

### Step 2: Create `mobile/src/offline-store.test.js`

Create `mobile/src/offline-store.test.js`:
1. Mock `expo-sqlite` with an in-memory SQL database or a structured mock that supports `execAsync`, `runAsync`, `getFirstAsync`, and `getAllAsync`.
2. Write unit tests for:
   - **Lease management**: `saveStoredLease` and `getStoredLease` (saving valid lease, reading locked state, updating existing lease).
   - **Downloads**: `saveStoredDownload`, `listStoredDownloads`, `removeStoredDownload` (storing JSON metadata, file versions, byte sizes, and cascading deletes).
   - **Download jobs**: `saveStoredDownloadJob`, `listStoredDownloadJobs`, `removeStoredDownloadJob` (interrupted download status recovery on startup).
   - **Playback outbox**: `enqueueStoredPlaybackEvent`, `listStoredPlaybackEvents`, `removeStoredPlaybackEvents` (FIFO ordering, JSON parsing, batch deletion of synced IDs).
   - **Local resumes**: `saveStoredResume`, `listStoredResumes`, `markStoredResumeClean` (dirty flag tracking, timestamp conflict resolution).

### Step 3: Run verification

**Verify**: `npm run test:mobile -- offline-store.test.js` → all pass.
**Verify**: `npm run test:mobile` → all 10 test files pass.
**Verify**: `npm run lint --workspace=mobile` → exit 0.

## Test plan

- Test coverage covers all 5 tables in `dogmedia-offline.db`.
- Tests verify schema creation, conflict handling (`ON CONFLICT DO UPDATE`), and outbox event batch purging.
- Verification command: `npm run test:mobile` passes completely.

## Done criteria

- [ ] `mobile/src/offline-store.test.js` exists and passes
- [ ] All 5 SQLite tables and their query wrappers are tested
- [ ] `npm run test:mobile` exits 0 across all test files
- [ ] `npm run lint --workspace=mobile` exits 0

## STOP conditions

- If mocking `expo-sqlite` introduces memory leaks or hanging async promises in vitest worker threads.

## Maintenance notes

- Any future schema migrations to `dogmedia-offline.db` must include corresponding migration test cases in `offline-store.test.js`.
