# Plan 013: Add Component and Workflow Tests for Admin Workspace

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- web/src/pages/Admin.jsx web/src/pages/Admin.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

`web/src/pages/Admin.jsx` contains 2,998 lines of React code orchestrating media chunking, uploads, batch edits, category management, and worker monitoring. However, `web/src/pages/Admin.test.js` tests only small string formatting helper functions from `admin-import-utils.js` and tests zero React component behavior or UI interactions.

Adding characterization tests for the Admin UI ensures that regressions during upload staging or media management are caught automatically before refactoring.

## Current state

- `web/src/pages/Admin.jsx` (2,998 lines) — 0 component tests.
- `web/src/pages/Admin.test.js` (88 lines) — tests only helper functions.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `npm run test:web`       | exit 0, all pass    |
| Lint      | `npm run lint --workspace=web` | exit 0        |

## Scope

**In scope**:
- `web/src/pages/Admin.test.jsx` (create or expand)
- `web/src/pages/admin-import-utils.js`

**Out of scope**:
- Refactoring `Admin.jsx` internals (deferred to Plan 014).

## Steps

### Step 1: Add Vitest Component Test Harness for Admin

Create tests mocking `/api/categories`, `/api/media`, and `/api/check-access`:
- Render Admin page for Tier 100 user.
- Verify tab switches (Upload, Edit, Releases, Categories).
- Verify file staging and chunk size calculation.

## Done criteria

- [ ] `npm run test:web` passes with new Admin component tests.
