# Plan 045: Scope media mutations to the caller's accessible categories

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/src/routes/media.js server/src/routes/media.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2bf8caa`, 2026-10-06

## Why this matters

Any whitelisted caller with tier ≥ 100 can update, delete, or force re-encoding
of media inside administrator-only (e.g. tier-999) categories by guessing its
sequential integer id, and can plant new uploads into restricted categories.
Read paths in the same file already enforce category-tier scoping; the mutating
paths do not. This is an object-level authorization bypass (IDOR). After this
plan, every media mutation is scoped to the caller's accessible category tree.

## Current state

The relevant files and their roles:

- `server/src/routes/media.js` — media CRUD, upload, streaming, encoding retry.
- `server/src/routes/media.test.js` — existing route tests (asserts SQL shapes; update if needed).

The accessible-category CTE already exists at the top of `media.js:50-76`
(`ACCESSIBLE_CATEGORY_TREE_SQL`, filters `c.min_access_tier <= $1`). Read
routes join it; mutating routes do not:

```js
// server/src/routes/media.js:1103-1106 — encoding retry lookup, NO tier scoping
const { rows } = await fastify.pg.query(
  "SELECT id, file_path, mime_type, content_kind, source_version FROM media_assets WHERE id = $1",
  [request.params.id]
);
```

```js
// server/src/routes/media.js:1143-1146 — PUT /:id, tier gate only, NO category scoping
"UPDATE media_assets SET title = COALESCE($1, title), ... WHERE id = $11 RETURNING *",
[title, description, hasDuration, normalizedDuration, ... , id]
```

```js
// server/src/routes/media.js:1172-1187 — DELETE /:id, tier gate only, then deletes files + row
const { rows } = await fastify.pg.query(
  "SELECT file_path, category_id, thumbnail_path FROM media_assets WHERE id = $1",
  [id]
);
...
await fastify.pg.query("DELETE FROM media_assets WHERE id = $1", [id]);
```

```js
// server/src/routes/media.js:346-353 — upload target-category check, NO tier check
const { rows: categoryRows } = await fastify.pg.query(
  "SELECT id, parent_id, cover_path FROM categories WHERE id = $1",
  [fields.category_id]
);
```

Exemplar to match — the read path at `media.js:724-743` joins the CTE and the
thumbnail route distinguishes 403 (exists but outside accessible tree) from 404
(see `media.js:1405-1417`: accessible query first, then bare-exists check for
the 403/404 split). Follow that exact pattern for PUT/DELETE/retry.

Repo conventions: plain `async (request, reply)` Fastify handlers, `pg.query`
with positional params, `reply.code(403).send({ error: "Access denied" })` for
tier failures and `reply.code(404).send({ error: "Not found" })` for missing
rows. Tests use the light-fastify inject pattern — model after
`server/src/routes/queue.test.js`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Server tests | `npm run test:server` | all pass (30 files / ~281 tests + new) |
| Lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `server/src/routes/media.js`
- `server/src/routes/media.test.js` (extend; create if absent — check first)

**Out of scope** (do NOT touch, even though they look related):

- `server/src/routes/queue.js`, `offline.js`, `playback.js` CTE copies — a separate dedup plan covers them; do not refactor the CTE itself here.
- `server/src/routes/whitelist.js` and generic id-format validation — covered by plan 049.
- Any change to response shapes for valid in-scope requests.

## Git workflow

- Branch: `advisor/045-media-mutation-scoping`
- Commit per logical unit; message style matches repo conventional commits, e.g. `fix(server): scope media mutations to accessible categories`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add category-tier scoping to PUT /:id, DELETE /:id, encoding retry

Rewrite the three statements to join the accessible tree:

1. `PUT /:id` (`media.js:1143`): change the `UPDATE` to
   `UPDATE media_assets m SET ... FROM accessible_categories ac WHERE m.id = $11 AND m.category_id = ac.id`,
   prefixed with `${ACCESSIBLE_CATEGORY_TREE_SQL}` and with `request.accessTier`
   as `$12` (renumber params accordingly). On zero rows, run a bare
   `SELECT 1 FROM media_assets WHERE id = $1` to distinguish 403 (exists,
   outside tree → `reply.code(403).send({ error: "Access denied" })`) from 404.
2. `DELETE /:id` (`media.js:1172` + `:1187`): scope the pre-select the same way
   (join `accessible_categories`, 403/404 split); only unlink files and run the
   `DELETE` when the scoped select hits.
3. `POST /:id/encoding/retry` (`media.js:1103-1106` and `:1119`): scope both the
   force-path select and the `SELECT 1` existence check through the accessible
   tree; out-of-tree ids return 403, unknown ids 404.

**Verify**: `npm run test:server` → all existing tests pass (some may need
updating in step 3 if they assert the old SQL).

### Step 2: Gate upload target category by tier in persistMediaUpload

In `persistMediaUpload` (`media.js:346-353`), replace the bare category lookup
with a scoped one: join the accessible tree (or select `min_access_tier` and
compare against `request.accessTier` in JS). If the category is missing → keep
existing `400 "Category not found"`; if it exists but `min_access_tier >
request.accessTier` → `reply.code(403).send({ error: "Access denied" })` after
`cleanupUploads(...)` (must clean temp files on this new early return — check
that every return path calls `cleanupUploads`).

**Verify**: `npm run test:server` → all pass.

### Step 3: Add regression tests

Extend `server/src/routes/media.test.js` (or the media-replacement test file if
that fits better — check what exists first) with:

- PUT /:id on media in a category above the caller's tier → 403, row unchanged.
- DELETE /:id on out-of-tree media → 403, row and files intact.
- encoding/retry on out-of-tree media → 403, nothing enqueued.
- POST / upload with `category_id` of a restricted category → 403.
- Happy paths unchanged: PUT/DELETE/retry/upload inside accessible categories
  still succeed (guard against over-scoping).

**Verify**: `npm run test:server` → all pass, including the new tests
(name them `... accessible category ...` so they are greppable).

## Test plan

- New tests listed in Step 3, modeled on the inject harness in
  `server/src/routes/queue.test.js`.
- Full `npm run test:server` green; `npm run lint --workspace=server` clean.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run test:server` exits 0, new 403/404 scoping tests exist and pass
- [ ] `grep -n "WHERE id = \$1" server/src/routes/media.js` shows no remaining
      unscoped mutation statements on the PUT/DELETE/retry/upload paths
      (read-path and 403/404-split existence checks excepted)
- [ ] `npm run lint --workspace=server` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  (the codebase has drifted since this plan was written).
- `ACCESSIBLE_CATEGORY_TREE_SQL` no longer exists or its `$1` convention
  changed (param renumbering in step 1 depends on it).
- A step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- Every new mutation route on `media_assets` must join the accessible tree —
  review checklist item. The CTE copies in `queue.js`/`offline.js`/`playback.js`
  are still duplicated (separate dedup plan); a scoping change must be applied
  in all copies until that lands.
- Watch for the 403-vs-404 distinction in review: existence oracle (404 vs 403
  tells an attacker the id exists). The thumbnail route already accepted this
  trade-off; this plan follows it for consistency.
