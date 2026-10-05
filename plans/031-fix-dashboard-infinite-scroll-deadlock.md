# Plan 031: Fix dashboard infinite scroll loading deadlock on filter change

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat edc7905..HEAD -- web/src/pages/Dashboard.jsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `edc7905`, 2026-10-04

## Why this matters

When a user switches categories, enters a search query, or changes the media type filter while an infinite-scroll page request is still in-flight, `browseGenerationRef.current` increments to invalidate stale responses. The `.finally()` handler on the fetch promise only clears `loadingMoreRef.current = false` when the generation still matches. If the generation has changed (because the user switched filters), the loading flag stays permanently `true`, locking out all subsequent pagination requests on the new view until the user reloads the page.

## Current state

Relevant files:
- `web/src/pages/Dashboard.jsx` — main media browsing surface

**`web/src/pages/Dashboard.jsx:488-493`** (the bug — loading flag reset guarded by generation):
```javascript
      .finally(() => {
        if (browseGenerationRef.current === generation) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      });
```

The data updates at lines 479-486 are correctly guarded by the generation check (stale data should be discarded). But the loading flag at line 490 must ALWAYS be reset, regardless of generation, because it gates future requests.

**Repo conventions**: React functional components with hooks. State refs use `useRef`. The pattern of generation-based staleness is used elsewhere in the same file (e.g. the main media fetch at lines 404-430 uses `cancelled` flag correctly).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Web tests | `npm run test:web` | exit 0, all pass |
| All tests | `npm run test` | exit 0, all pass |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `web/src/pages/Dashboard.jsx`

**Out of scope** (do NOT touch):
- Any other component or page file
- The data-update logic inside `.then()` at lines 479-486 (the generation guard there is correct)

## Git workflow

- Branch: `fix/031-dashboard-scroll-deadlock`
- Commit style: `fix(web): always reset infinite scroll loading flag in finally handler`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Move loadingMoreRef reset outside the generation guard

In `web/src/pages/Dashboard.jsx`, find the `.finally()` handler around line 488-493. Change it so that `loadingMoreRef.current = false` is always executed, while `setLoadingMore(false)` remains inside the guard (it's a React state update that triggers a re-render and should only fire for the current generation):

Change:
```javascript
      .finally(() => {
        if (browseGenerationRef.current === generation) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      });
```

To:
```javascript
      .finally(() => {
        loadingMoreRef.current = false;
        if (browseGenerationRef.current === generation) {
          setLoadingMore(false);
        }
      });
```

**Verify**: `grep -A5 '.finally' web/src/pages/Dashboard.jsx | head -10` → shows `loadingMoreRef.current = false;` before the `if` guard

### Step 2: Run tests

**Verify**: `npm run test` → exit 0, all tests pass
**Verify**: `npm run lint` → exit 0

## Test plan

No new test file needed. This is a one-line move of an existing statement. The bug is a race condition that's difficult to unit-test without a full React testing environment with controlled async timing. The fix is mechanical and low-risk.

## Done criteria

- [ ] `npm run test` exits 0
- [ ] `npm run lint` exits 0
- [ ] `loadingMoreRef.current = false` appears before the generation guard `if` in the `.finally()` block
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back if:
- The `.finally()` handler at lines 488-493 doesn't match the excerpt
- `loadingMoreRef` has been renamed or removed
- The infinite scroll mechanism has been replaced with a different pattern

## Maintenance notes

- If infinite scroll is refactored (e.g. into a custom hook), the loading flag reset must always be in a `finally` clause unconditionally.
- Similar generation-guarded loading patterns should be audited if they appear elsewhere.

## Implementation

Completed on 2026-10-04. A browse-generation change now invalidates the old
pagination lock and resets both its synchronous ref and rendered loading state.
Stale pagination finalizers remain generation-guarded so they cannot clear the
lock owned by a newer request.
