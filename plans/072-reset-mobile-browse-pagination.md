# Plan 072: Reset mobile pagination when browse filters change

> **Executor instructions**: Follow the steps and gates below. Update only this plan's status row in `plans/README.md` when done. Stop at the listed conditions.
>
> **Drift check first**: `git diff --stat d436e4f..HEAD -- mobile/src/screens/dashboard-screen.jsx mobile/src/utils/dashboard-pagination.js mobile/src/utils/dashboard-pagination.test.js`. If the screen changed, compare it with the excerpts below before proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW; changes the browse request lifecycle only.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d436e4f`, 2026-10-26

## Why this matters

Mobile dashboard infinite scroll sets `loadingMore` when a page request starts. If the user changes category, media type, or search before it finishes, the new first-page request advances the generation but does not reset `loadingMore`. The old page's `finally` skips its reset because its generation is stale, so `loadMore` can remain blocked indefinitely.

## Current state

- `mobile/src/screens/dashboard-screen.jsx:98-109` stores `nextCursor`, `mediaLoading`, `loadingMore`, and `browseGenerationRef`.
- `:145-171` starts a new browse generation and clears media/cursor, but does not call `setLoadingMore(false)`:
  ```jsx
  const generation = browseGenerationRef.current + 1;
  browseGenerationRef.current = generation;
  setMediaLoading(true);
  setMedia([]);
  setNextCursor(null);
  ```
- `:174-193` refuses to load when `loadingMore` is true, starts the page request, and only clears `loadingMore` in `finally` if the generation still matches.
- `:204-214` reloads when filters change; `:263-270` wires `FlatList.onEndReached` to `loadMore`.
- Mobile uses JS/JSX, functional hooks, and Vitest tests under `mobile/src/utils/` (for example `categories.test.js`). There is no installed React Native component renderer in this repository.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm run test:mobile -- --run src/utils/dashboard-pagination.test.js` | exit 0 |
| Mobile lint | `npm run lint --workspace=mobile` | exit 0 |
| Mobile suite | `npm run test:mobile` | exit 0 |

## Scope

**In scope**: `mobile/src/screens/dashboard-screen.jsx`, new `mobile/src/utils/dashboard-pagination.js`, new `mobile/src/utils/dashboard-pagination.test.js`, this plan's row in `plans/README.md`.

**Out of scope**: server browse pagination, `FlatList` presentation, dashboard summary requests (Plan 073), web Dashboard, and unrelated mobile navigation.

## Git workflow

Use `advisor/072-reset-mobile-browse-pagination` and a conventional commit such as `fix(mobile): reset browse paging on filter change`. Do not push or open a PR without operator instruction.

## Steps

### Step 1: Characterize overlapping page requests

Create a small `createDashboardPaginationGate` in `mobile/src/utils/dashboard-pagination.js` with operations to start a new browse generation, start one page for that generation, check whether a result is current, and finish a page. A new browse generation must clear the page-in-flight state; finishing an old page must not clear a newer page's in-flight state. Write deferred-promise tests that simulate page A in flight, filter reset, page B in flight, late A completion, then B completion. Assert A is ignored, B applies, and paging is available again. Include a reset without a new page.

**Verify**: `npm run test:mobile -- --run src/utils/dashboard-pagination.test.js` → all gate lifecycle tests pass.

### Step 2: Wire the gate into the screen

Replace `browseGenerationRef` with a stable `useRef(createDashboardPaginationGate())`. `loadMedia` begins a new generation and synchronously clears UI `loadingMore` along with media/cursor. `loadMore` starts a page only when a cursor exists and the gate is free; it applies items/cursor only for the current ticket. In `finally`, update `loadingMore` from the gate's current in-flight state, so a stale completion cannot falsely clear a newer request. Keep existing deduplication and notice behavior. Avoid a state update after unmount by invalidating the gate in effect cleanup if the current pattern permits it.

**Verify**: `npm run test:mobile -- --run src/utils/dashboard-pagination.test.js && npm run lint --workspace=mobile` → exit 0.

### Step 3: Verify mobile behavior

Run the full mobile suite. On a device or emulator when available, start a long page load, change category/type/search, and scroll to the end of the new result list: the next page must load. Record manual validation separately if no device is available; do not substitute a code-inspection claim for a device run.

**Verify**: `npm run test:mobile` → exit 0; manual device check (if available) loads the next page after switching filters.

## Test plan

The new gate test should use deferred promises, as `mobile/src/components/full-player-session.test.jsx` does. It must cover both completion orders and a stale error, proving that an old request cannot overwrite new results or keep paging busy. No React Native renderer dependency is required for this focused state-machine regression.

## Done criteria

- [ ] Focused gate tests, mobile lint, and full mobile tests exit 0.
- [ ] A filter reset clears page-loading state and late old completion cannot block the new list.
- [ ] Device check is recorded as passed or pending when no device is available.
- [ ] Only scoped files and this plan's index row change.

## STOP conditions

- The browse endpoint's cursor contract changed so old and new cursors cannot be distinguished by generation.
- A fix requires adding a new React Native renderer dependency or changing the server route.
- Drift review mismatches or a gate fails twice.

## Maintenance notes

Keep the page gate and UI `loadingMore` synchronized whenever browse filters or cursors are added. Plan 073 also edits this screen; apply it after this plan and re-check the drift excerpt.
