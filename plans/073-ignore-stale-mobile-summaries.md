# Plan 073: Ignore stale mobile dashboard summary responses

> **Executor instructions**: Follow the steps and gates below. Update only this plan's status row in `plans/README.md` when done. Stop at the listed conditions.
>
> **Drift check first**: `git diff --stat d436e4f..HEAD -- mobile/src/screens/dashboard-screen.jsx mobile/src/utils/dashboard-summary.js mobile/src/utils/dashboard-summary.test.js`. Plan 072 is expected to change the screen's browse paging block. Compare the `loadSummary` and effect excerpts below specifically; stop if those lines changed for another reason.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW; affects only summary request ordering.
- **Depends on**: Plan 072, because both edit `dashboard-screen.jsx`
- **Category**: bug
- **Planned at**: commit `d436e4f`, 2026-10-26

## Why this matters

Changing category or media type starts another dashboard summary request. An older response can arrive later and overwrite the new summary. The featured item, quick access, and recently played rows are then derived from the wrong filter even when the media list is current.

## Current state

- `mobile/src/screens/dashboard-screen.jsx:195-202` issues an unguarded request:
  ```jsx
  apiJson(`/api/playback/dashboard?${params.toString()}`)
    .then(setSummary)
    .catch(() => setSummary(null));
  ```
- `:209-214` calls `loadMedia` and `loadSummary` in an effect, but its cleanup aborts only the media request.
- `:228-237` derives featured, quick access, and recently played entries from `summary`; a stale response therefore changes visible cards.
- The screen uses React hooks and `apiJson` from `mobile/src/api.js`. The mobile test suite uses Vitest; `mobile/src/components/full-player-session.test.jsx` uses deferred promises for stale asynchronous work. There is no installed React Native component renderer.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm run test:mobile -- --run src/utils/dashboard-summary.test.js` | exit 0 |
| Mobile lint | `npm run lint --workspace=mobile` | exit 0 |
| Mobile suite | `npm run test:mobile` | exit 0 |

## Scope

**In scope**: `mobile/src/screens/dashboard-screen.jsx`, new `mobile/src/utils/dashboard-summary.js`, new `mobile/src/utils/dashboard-summary.test.js`, this plan's row in `plans/README.md`.

**Out of scope**: browse pagination behavior from Plan 072, server dashboard SQL, featured-card layout, web Dashboard, and global player state.

## Git workflow

Use `advisor/073-ignore-stale-mobile-summaries`; commit as `fix(mobile): ignore stale dashboard summaries`. Do not push or open a PR without operator instruction.

## Steps

### Step 1: Add a latest-request helper and race tests

Create `createLatestSummaryLoader({ fetchSummary, applySummary })` in `mobile/src/utils/dashboard-summary.js`. It should return `load(url, signal)` and `invalidate()`. Every `load` gets a monotonically increasing generation; only the latest generation may call `applySummary` on success or set null on a real failure. `invalidate()` makes an outstanding generation stale, including when the screen unmounts. A rejected/aborted stale request must not clear a newer summary. Test with two deferred fetches resolved in both orders and with a late old rejection.

**Verify**: `npm run test:mobile -- --run src/utils/dashboard-summary.test.js` → race tests pass.

### Step 2: Use the helper in the screen

Create one stable loader in a ref using `apiJson` and `setSummary`; have `loadSummary` build the existing URL and call that loader. In the effect at `:209-214`, pass an `AbortController.signal` to the summary request as well as the media request. On cleanup, abort and invalidate the summary generation. Keep the current summary response shape and fallback to null for the current request's actual error. Do not reuse the browse generation for summary requests, because their filters and lifecycles differ.

**Verify**: `npm run test:mobile -- --run src/utils/dashboard-summary.test.js && npm run lint --workspace=mobile` → exit 0.

### Step 3: Check full mobile behavior

Run all mobile tests. On a device/emulator when available, change category/type rapidly while summary responses are delayed; featured and quick-access cards must match the final filter. Record device validation as pending if unavailable.

**Verify**: `npm run test:mobile` → exit 0; device check (if available) shows final-filter summary.

## Test plan

Model deferred-promise sequencing on `mobile/src/components/full-player-session.test.jsx`. Assert both response orders, late error, and unmount invalidation. Test the callbacks' visible data values; do not merely inspect a generation counter.

## Done criteria

- [ ] Focused tests, mobile lint, and full mobile tests exit 0.
- [ ] An old summary success or error never overwrites the result for a newer filter.
- [ ] Device validation is recorded as passed or pending.
- [ ] Only scoped files and this plan's index row change.

## STOP conditions

- Plan 072 changed the `loadSummary` block or effect beyond the expected paging block; reconcile before editing.
- The fix requires changing server response shape or adding a renderer dependency.
- A gate fails twice or unrelated drift affects the summary logic.

## Maintenance notes

Summary filters currently use category and media type, while search affects the media list. If summary becomes search-aware, keep the loader's generation boundary aligned with all three inputs.
