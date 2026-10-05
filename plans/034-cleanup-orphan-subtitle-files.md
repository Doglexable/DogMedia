# Plan 034: Remove orphaned subtitle files on media deletion

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat edc7905..HEAD -- server/src/routes/media.js server/src/media-cleanup.js`
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

When a media asset is deleted via `DELETE /api/media/:id`, the handler removes the media file, thumbnail, and category directory, but never removes `data/subtitles/${id}/`. Subtitle files (`.vtt`, `.ass`) created by `extractMediaSubtitles` persist on disk indefinitely. The orphan cleanup worker (`media-cleanup.js`) also never scans the `subtitles/` directory. Over time, deleted media accumulates orphaned subtitle files that leak disk space.

## Current state

Relevant files:
- `server/src/routes/media.js` — media CRUD routes including DELETE handler
- `server/src/media-cleanup.js` — background orphan file cleanup
- `server/src/routes/media.test.js` — existing media route tests

**`server/src/routes/media.js:1166-1187`** (delete handler — no subtitle cleanup):
```javascript
  fastify.delete("/:id", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      "SELECT file_path, category_id, thumbnail_path FROM media_assets WHERE id = $1",
      [id]
    );
    if (rows.length === 0) return reply.code(404).send({ error: "Not found" });

    const filePath = join(dataDir, rows[0].file_path);
    await unlink(filePath).catch(() => {});
    if (rows[0].thumbnail_path) {
      await unlink(join(dataDir, rows[0].thumbnail_path)).catch(() => {});
    }

    await rm(join(dataDir, String(rows[0].category_id), String(id)), { recursive: true, force: true }).catch(() => {});

    await fastify.pg.query("DELETE FROM media_assets WHERE id = $1", [id]);
    return reply.code(204).send();
  });
```

Note: `rm` is imported from `fs/promises` at the top of `media.js`. The `dataDir` variable is defined at line ~42.

Subtitles are stored at `data/subtitles/${mediaId}/` as shown in `server/src/subtitles.js:119`:
```javascript
  const subDir = join(dataDir, "subtitles", String(mediaId));
```

**Repo conventions**: Cleanup operations use `await rm(..., { recursive: true, force: true }).catch(() => {})` to silently handle missing directories.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Server tests | `npm run test:server` | exit 0, all pass |
| All tests | `npm run test` | exit 0, all pass |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `server/src/routes/media.js`
- `server/src/routes/media.test.js` (add assertion for subtitle cleanup)

**Out of scope** (do NOT touch):
- `server/src/media-cleanup.js` — extending the orphan scanner is a separate improvement
- `server/src/subtitles.js` — subtitle extraction logic is correct
- Any client code

## Git workflow

- Branch: `fix/034-cleanup-orphan-subtitles`
- Commit style: `fix(server): remove subtitle files when deleting media assets`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add subtitle directory removal to the DELETE handler

In `server/src/routes/media.js`, in the `DELETE /:id` handler, add subtitle cleanup after the existing `rm` call for the category directory (after line 1183) and before the database DELETE:

```javascript
    await rm(join(dataDir, "subtitles", String(id)), { recursive: true, force: true }).catch(() => {});
```

The handler should now look like:
```javascript
    await rm(join(dataDir, String(rows[0].category_id), String(id)), { recursive: true, force: true }).catch(() => {});
    await rm(join(dataDir, "subtitles", String(id)), { recursive: true, force: true }).catch(() => {});

    await fastify.pg.query("DELETE FROM media_assets WHERE id = $1", [id]);
```

**Verify**: `grep -n 'subtitles' server/src/routes/media.js` → shows the new subtitle removal line in the DELETE handler

### Step 2: Add test assertion

In `server/src/routes/media.test.js`, find the existing test for `DELETE /api/media/:id`. Create a subtitle directory in the test's temp `dataDir` (e.g. `mkdir(join(dataDir, "subtitles", "42"), { recursive: true })` and write a dummy `.vtt` file), then after the delete request, assert the subtitle directory no longer exists.

Follow the existing test pattern in `media.test.js` which creates temp directories and verifies cleanup.

**Verify**: `npm run test:server` → all pass including updated test

### Step 3: Final verification

**Verify**: `npm run test` → exit 0
**Verify**: `npm run lint` → exit 0

## Test plan

- Modified test in `server/src/routes/media.test.js`:
  - DELETE media → subtitle directory is removed
- Model after existing delete test in `media.test.js`.
- Verification: `npm run test:server` → all pass

## Done criteria

- [ ] `npm run test` exits 0
- [ ] `npm run lint` exits 0
- [ ] `grep 'subtitles' server/src/routes/media.js` shows subtitle directory removal in DELETE handler
- [ ] Test verifies subtitle directory cleanup
- [ ] No files outside the in-scope list are modified

## STOP conditions

Stop and report back if:
- The DELETE handler at lines 1166-1187 doesn't match the excerpt
- The `rm` import is missing from `media.js`
- The subtitle directory structure (`subtitles/${mediaId}/`) has changed in `subtitles.js`

## Maintenance notes

- If `replaceMediaFiles` (line ~460) is updated to handle subtitle re-extraction, it should also clean old subtitles before re-extracting.
- The orphan cleanup worker (`media-cleanup.js`) could be extended in a follow-up to scan `data/subtitles/` and remove directories whose IDs don't exist in `media_assets`.

## Implementation

Completed on 2026-10-04. Deleting a media asset now recursively removes its
`data/subtitles/{mediaId}` directory before deleting the database record. The
existing deletion route test now creates a subtitle fixture and verifies the
directory is removed together with the source file, thumbnail, and media folder.
