# Plan 014: Decompose Monolithic Admin Page into Feature Modules

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- web/src/pages/Admin.jsx web/src/components/admin/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/013-admin-integration-tests.md
- **Category**: tech-debt
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

`web/src/pages/Admin.jsx` is a monolithic file of 2,998 lines and 121KB containing over 45 `useState` hooks. It bundles chunked upload staging, episode ordering, category hierarchy editing, mobile APK release uploads, worker queue telemetry, and batch media replacement in a single component.

Splitting this component into modular subcomponents under `web/src/components/admin/` drastically reduces cognitive overhead, isolates state mutations, and prevents unrelated regressions.

## Current state

- `web/src/pages/Admin.jsx`: 2,998 lines.

## Scope

**In scope**:
- `web/src/pages/Admin.jsx`
- `web/src/components/admin/` (create subcomponents)

## Steps

### Step 1: Extract Subcomponents

Decompose into:
- `MediaUploadWorkspace.jsx` — chunked uploads & file staging.
- `CategoryManager.jsx` — category hierarchy and cover art.
- `MobileReleaseManager.jsx` — APK uploads and release notes.
- `UploadQueueViewer.jsx` — worker queue status.

### Step 2: Verify

Run `npm run test:web` and verify that all tests written in Plan 013 continue to pass.

## Done criteria

- [ ] `web/src/pages/Admin.jsx` reduced to < 500 lines as a clean coordinator.
- [ ] `npm run lint --workspace=web` exits 0.
- [ ] `npm run test:web` exits 0.
