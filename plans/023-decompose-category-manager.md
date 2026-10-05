# Plan 023: Decompose Monolithic CategoryManager Component into Feature Modules

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 50f1f36..HEAD -- web/src/components/admin/CategoryManager.jsx web/src/pages/Admin.jsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/015-fix-site-footer-rgb-tokens.md
- **Category**: tech-debt
- **Planned at**: commit `50f1f36`, 2026-09-22

## Why this matters

Plan 014 initially scoped decomposing `web/src/pages/Admin.jsx` into feature modules. Commit `4a87fd5` reduced `Admin.jsx` to a 6-line facade rendering `<CategoryManager />`, and extracted `MediaUploadWorkspace.jsx`, `MobileReleaseManager.jsx`, and `UploadQueueViewer.jsx`. However, `web/src/components/admin/CategoryManager.jsx` remains a massive 2,446-line monolith with 57 `useState` hooks. It bundles category tree hierarchies, modal dialogs for category creation/editing, album batch track ordering, video episode sequence editors, and media metadata editing in a single file. Decomposing these modals into focused subcomponents under `web/src/components/admin/` isolates state mutations and reduces `CategoryManager.jsx` to an easy-to-maintain coordinator under 500 lines.

## Current state

The relevant files:
- `web/src/components/admin/CategoryManager.jsx` (2,446 lines) — monolithic admin component.
- `web/src/components/admin/category-tree-dnd.jsx` (288 lines) — drag-and-drop category tree.
- `web/src/components/admin/MediaUploadWorkspace.jsx` (204 lines) — chunk upload workspace.
- `web/src/components/admin/MobileReleaseManager.jsx` (149 lines) — APK release manager.
- `web/src/components/admin/UploadQueueViewer.jsx` (88 lines) — queue status viewer.
- `web/src/pages/Admin.test.jsx` — integration tests verifying Admin workspace tabs and chunk splitting.

Current-state excerpts:
`web/src/components/admin/CategoryManager.jsx:1-17`:
```javascript
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
...
import { CategoryTreeDnd } from "./category-tree-dnd";
import MediaUploadWorkspace, { replaceMediaFilesInChunks, uploadCategoryCover, uploadMediaInChunks } from "./MediaUploadWorkspace";
import MobileReleaseManager, { uploadAndroidRelease } from "./MobileReleaseManager";
import UploadQueueViewer, { BrowserTransferProgress } from "./UploadQueueViewer";
```

Repo conventions:
- React 19 functional components + hooks.
- Modals accept `isOpen`, `onClose`, and mutation callbacks as props.
- CSS co-located in `web/src/pages/admin-media-import.css`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Admin tests | `npm run test:web -- Admin.test.jsx` | all pass |
| Web tests | `npm run test:web` | all pass |
| Web lint | `npm run lint --workspace=web` | exit 0 |

## Scope

**In scope**:
- `web/src/components/admin/CategoryManager.jsx` — decompose into coordinator < 500 lines.
- `web/src/components/admin/CategoryEditModal.jsx` (create) — category creation and editing modal.
- `web/src/components/admin/MediaMetadataEditorModal.jsx` (create) — media detail and metadata editor modal.
- `web/src/components/admin/EpisodeOrderModal.jsx` (create) — video episode sequence ordering modal.

**Out of scope**:
- `web/src/components/admin/MediaUploadWorkspace.jsx` — already extracted.
- `web/src/components/admin/MobileReleaseManager.jsx` — already extracted.
- `web/src/components/admin/UploadQueueViewer.jsx` — already extracted.
- Modifying backend `/api/categories` or `/api/media` API contracts.

## Git workflow

- Branch: `advisor/023-decompose-category-manager`
- Commit style: `refactor(web): decompose monolithic CategoryManager into modular subcomponents`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Extract `CategoryEditModal.jsx`

Extract category creation, renaming, and tier requirement editing from `CategoryManager.jsx` into `web/src/components/admin/CategoryEditModal.jsx`:
- Props: `isOpen`, `category`, `categories`, `onClose`, `onSave`.
- Isolate state: `name`, `parentId`, `minAccessTier`, `coverFile`, saving progress.

### Step 2: Extract `MediaMetadataEditorModal.jsx`

Extract individual media metadata editing (title, artists, description, track order, thumbnail replacement, lyric assignment) into `web/src/components/admin/MediaMetadataEditorModal.jsx`:
- Props: `isOpen`, `media`, `onClose`, `onSave`.
- Isolate state: form fields, dirty state, submission status.

### Step 3: Extract `EpisodeOrderModal.jsx`

Extract video episode reordering and batch title management into `web/src/components/admin/EpisodeOrderModal.jsx`:
- Props: `isOpen`, `episodes`, `onClose`, `onSaveOrder`.
- Isolate state: drag order array, pending save indicator.

### Step 4: Streamline `CategoryManager.jsx`

Refactor `CategoryManager.jsx` to import and coordinate the extracted subcomponents:
- Coordinate active tab selection, category tree selection, and modal open/close states.
- Ensure total line count in `CategoryManager.jsx` drops below 500 lines.

### Step 5: Verify with vitest and lint

**Verify**: `npm run test:web -- Admin.test.jsx` → all pass.
**Verify**: `npm run lint --workspace=web` → exit 0.

## Test plan

- Verify that Admin workspace tabs continue to switch correctly.
- Verify that category creation, metadata editing, and episode reordering modals open and trigger API calls properly.
- Verify `npm run test:web` passes without regressions.

## Done criteria

- [ ] `web/src/components/admin/CategoryManager.jsx` has fewer than 500 lines of code (`wc -l web/src/components/admin/CategoryManager.jsx` < 500)
- [ ] `CategoryEditModal.jsx`, `MediaMetadataEditorModal.jsx`, and `EpisodeOrderModal.jsx` exist under `web/src/components/admin/`
- [ ] `npm run test:web -- Admin.test.jsx` exits 0
- [ ] `npm run lint --workspace=web` exits 0

## STOP conditions

- If separating state breaks DnD reordering context in `category-tree-dnd.jsx`.
- If existing integration tests in `Admin.test.jsx` fail.

## Maintenance notes

- Each administrative subcomponent should remain isolated and avoid reading global DOM state or uncoordinated context selectors.
