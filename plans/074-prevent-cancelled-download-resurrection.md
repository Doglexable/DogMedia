# Plan 074: Keep cancelled mobile downloads from reappearing

> **Executor instructions**: Follow the steps and gates below. Update only this plan's row in `plans/README.md` when complete. Stop at the listed conditions.
>
> **Drift check first**: `git diff --stat d436e4f..HEAD -- mobile/src/context/offline-context.jsx mobile/src/utils/download-lifecycle.js mobile/src/utils/download-lifecycle.test.js`. If the provider changed, compare the excerpts below and stop on a mismatch.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED; cancellation spans a network download, optional assets, local files, and SQLite.
- **Depends on**: none; coordinate with Plan 070 if both are executed together because its manifest quality affects download verification.
- **Category**: bug
- **Planned at**: commit `d436e4f`, 2026-10-26

## Why this matters

After audio bytes finish downloading, the mobile provider awaits file verification, a move, optional thumbnail download, and lyrics before saving a ready row. `cancelDownload` marks a cancellation, but the success path never checks it before saving. `removeDownload` and `removeAll` can therefore report success while the in-flight job later writes a new ready row or leaves an audio file behind.

## Current state

- `mobile/src/context/offline-context.jsx:89-93` stores active downloads and a cancellation set in refs.
- `:243-277` moves the completed file, downloads artwork, fetches lyrics, and calls `saveStoredDownload(...)` without reading `cancelledDownloadsRef` on the success path:
  ```jsx
  await FileSystem.moveAsync({ from: partUri, to: fileUri });
  // optional thumbnail and lyrics awaits
  await saveStoredDownload({ id: item.id, metadata: metadataFromManifest(item), fileUri, ... });
  ```
- `:278-292` uses the cancellation set only in `catch`, then clears it in `finally`.
- `:332-355` sets cancellation and calls `pauseAsync`, then `removeDownload` deletes the current row/job/files. `:388-394` cancels active jobs before clearing all rows/files.
- `mobile/src/offline-store.test.js` tests SQLite row operations; it does not exercise the provider's asynchronous finalization. Use the deferred-promise pattern from `mobile/src/components/full-player-session.test.jsx` for this race.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused lifecycle tests | `npm run test:mobile -- --run src/utils/download-lifecycle.test.js` | exit 0 |
| Offline store tests | `npm run test:mobile -- --run src/offline-store.test.js` | exit 0 |
| Mobile lint | `npm run lint --workspace=mobile` | exit 0 |
| Mobile suite | `npm run test:mobile` | exit 0 |

## Scope

**In scope**: `mobile/src/context/offline-context.jsx`, new `mobile/src/utils/download-lifecycle.js`, new `mobile/src/utils/download-lifecycle.test.js`, this plan's row in `plans/README.md`.

**Out of scope**: `mobile/src/offline-store.js` schema, server offline routes, network policy, retry UI, account auth, and storage of already completed unrelated downloads.

## Git workflow

Use `advisor/074-prevent-cancelled-download-resurrection` and a conventional commit such as `fix(mobile): prevent cancelled downloads from being saved`. Do not push or open a PR without operator instruction.

## Steps

### Step 1: Specify finalization ownership and test it

Create a small lifecycle helper in `mobile/src/utils/download-lifecycle.js` that issues a unique attempt token per media ID, marks that token cancelled, checks whether it is still current, and invalidates all active tokens for Remove all/account clear. Keep cancellation attached to the attempt token so cancelling an old attempt does not cancel a later retry of the same media ID. Write deferred tests for (a) cancel after bytes finish but before artwork resolves, (b) Remove all while lyrics resolve, (c) cancel while the save promise is in flight, and (d) retry starts a new token and succeeds. Assert which attempt may persist, not just the boolean state of the helper.

**Verify**: `npm run test:mobile -- --run src/utils/download-lifecycle.test.js` → lifecycle tests pass.

### Step 2: Guard the provider's write path and clean files

Assign an attempt token when `processJob` begins; `createClientEventId()` from `mobile/src/offline-store.js` is already available for a unique suffix. Use that suffix in this attempt's `.part`, final audio, and thumbnail paths so old cleanup cannot delete a later retry or a previously saved download. Make `cancelDownload`, `removeDownload`, `removeAll`, and `clearAccountData` invalidate relevant tokens before they await `pauseAsync` or file deletion. In `processJob`, check the token after every asynchronous stage and immediately before `saveStoredDownload`. A cancelled attempt must delete only paths it created and must not mark a job ready. If cancellation occurs while `saveStoredDownload` is already in flight, check again after that await and remove that attempt's row only if its stored `fileUri` still equals this attempt's unique path; do not delete a newer retry's data. Keep paused-network behavior distinct from user cancellation. Avoid an old `finally` clearing a new attempt's cancellation state.

**Verify**: `npm run test:mobile -- --run src/utils/download-lifecycle.test.js src/offline-store.test.js` → exit 0; cancellation tests show no ready row/file after late completion.

### Step 3: Verify Remove all and normal downloads

Run mobile lint and full tests. When a device/emulator is available, cancel during artwork fetch and use Remove all during an active download; after several seconds and app restart, no removed item should reappear. Also complete one normal download and one retry. Record manual checks as pending if no device is available.

**Verify**: `npm run lint --workspace=mobile && npm run test:mobile` → exit 0; device acceptance (if available) confirms no resurrection.

## Test plan

Use an injected async finalization wrapper or fake persistence callbacks around the lifecycle helper so deferred `save`, artwork, and lyrics operations actually exercise the ownership checks. Include a test where an old cancelled attempt finishes after a new retry; the old cleanup must not delete the new file or row. Existing `offline-store.test.js` remains the SQL pattern. Avoid a test that only toggles a cancellation flag.

## Done criteria

- [ ] Focused lifecycle/store tests, mobile lint, and full mobile tests exit 0.
- [ ] Cancel/Remove all invalidates active attempt tokens before asynchronous cancellation work.
- [ ] Late success and late failure cannot recreate a removed ready row or leave an orphaned final file; a newer retry remains intact.
- [ ] Device checks are recorded as passed or pending.
- [ ] Only scoped files and this plan's index row change.

## STOP conditions

- The stored download row cannot be read back to compare its `fileUri` before post-save cancellation cleanup; report that missing ownership guard rather than deleting by media ID alone.
- The fix requires changing SQLite schema, server API, or app-wide account reset behavior.
- Drift review mismatches or a gate fails twice.

## Maintenance notes

Review every new `await` inserted between byte completion and persistence. Cancellation must remain valid across that gap. A future concurrent-download increase will make per-attempt file paths and cleanup ownership more important.
