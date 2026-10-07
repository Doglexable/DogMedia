# Plan 052: Index browse search and paginate media list with Admin compatibility

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/src/routes/media.js server/src/migrations server/src/routes/media.test.js web/src/components/admin/CategoryManager.jsx web/src/pages/Admin.test.jsx`
> Also run `git diff --stat --` with the same paths to catch uncommitted work.
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch in the list, browse, or Admin load paths, treat it as a STOP
> condition. Existing edits from plans 045–049 touch `media.js` and
> `media.test.js` outside these paths; preserve them.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `2bf8caa`, 2026-10-06
- **Revised**: 2026-10-06 after the Admin caller audit found an unbounded-list dependency.
- **Execution status**: BLOCKED-needs-DB-verify

## Why this matters

Every browse keystroke pays a sequential scan (leading-`%` LIKE over a
concatenated expression plus an OR branch on an unindexed category name), and
`GET /api/media` has no pagination at all — unbounded full-library selects
with per-row encoding subqueries. After this plan, category-name searches hit
a trigram index, the media expression search uses the existing index
efficiently, and the list endpoint is bounded without hiding category media
from Admin.

## Current state

Relevant files:

- `server/src/routes/media.js:50-100` — CTE + `MEDIA_ENCODING_FIELDS`
  (two correlated subqueries per row, inlined at `:601,698,729`).
- `server/src/routes/media.js:596-634` — `GET /` (no LIMIT).
- `server/src/routes/media.js:636-722` — `GET /browse` (limit ≤ 100, cursor;
  search at `:675-683`).
- `server/src/migrations/013_performance_indexes.sql:3-10` — trigram index on
  the media-concat expression only; nothing on `categories.name`.
- `server/src/routes/media.test.js:137-139` — asserts current search SQL shape
  (will need updating; read it first).
- `web/src/components/admin/CategoryManager.jsx:137,194,341` — three
  `GET /api/media?category_id=...` paths load the entire category into
  `categoryMedia`. The collection list and `EpisodeOrderModal` use that full
  array, so a default 100-row cap would silently hide later items.
- `web/src/pages/Admin.test.jsx` — mocks the current one-request Admin load.
  Audit found no direct list caller in `mobile/src`; recheck before execution.

```js
// server/src/routes/media.js:675-683 — search defeating the index
if (search) {
  const escapedSearch = search.replace(/[\\%_]/g, "\\$&");
  params.push(`%${escapedSearch}%`);
  const searchParamIndex = params.length;
  clauses.push(`(
    lower(coalesce(m.title, '') || ' ' || coalesce(m.artists, '') || ' ' || coalesce(m.description, '')) LIKE lower($${searchParamIndex}) ESCAPE '\\'
    OR lower(ac.name) LIKE lower($${searchParamIndex}) ESCAPE '\\'
  )`);
}
```

```js
// server/src/routes/media.js:596-633 — GET / with no LIMIT (unbounded)
fastify.get("/", async (request) => {
  ...
  query += ` ORDER BY ...`;
  const { rows } = await fastify.pg.query(query, params);
  return rows;
});
```

Repo conventions: migrations are numbered plain SQL run sequentially via
`node server/src/migrate.js` (see plan 009 — migrations run in transactions);
`pg_trgm` usage established in migration 013 (check it for the exact
`CREATE INDEX ... USING gin (... gin_trgm_ops)` spelling to copy).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Migrate | `npm run migrate --workspace=server` | exit 0 (needs DB) |
| Server tests | `npm run test:server` | all pass |
| Web tests | `npm run test:web` | all pass |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope**:

- `server/src/migrations/0NN_*.sql` — one new migration (next number; list the
  directory first): trigram index on `lower(categories.name)`.
- `server/src/routes/media.js` (`GET /browse` search clause; `GET /` pagination).
- `server/src/routes/media.test.js` (update SQL-shape assertions + new tests).
- `web/src/components/admin/CategoryManager.jsx` (load every page for a
  selected category before publishing `categoryMedia`, across all refresh paths).
- `web/src/pages/Admin.test.jsx` (multi-page Admin regression tests). A small
  web helper and focused test may be added if it keeps the loader reusable.

**Out of scope**:

- Removing the per-row `MEDIA_ENCODING_FIELDS` subqueries (lazy/batched
  encoding status is a separate follow-up; do not attempt here).
- Changing search relevance/ranking beyond index compatibility — keep the same
  match semantics (substring, case-insensitive) so client behavior is unchanged.
- Full-text-search migration (`tsvector`) — out of scope; trigram only.

## Git workflow

- Branch: `advisor/052-browse-search-index-pagination`
- Conventional commits, e.g. `perf(server): index browse search and paginate media list`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add trigram index on category name

1. List `server/src/migrations/` for the next free number.
2. Write migration `0NN_browse_category_trgm.sql` mirroring the style of 013:
   `CREATE INDEX IF NOT EXISTS ... ON categories USING gin (lower(name) gin_trgm_ops);`
   (guard with IF NOT EXISTS per the convention in newer migrations).
3. Run `npm run migrate --workspace=server` against a dev DB if available; if
   no DB is reachable, note it and rely on test-level verification (do not
   block — record the gap in your report).

**Verify**: migration applies cleanly (or is syntactically consistent with 013
if no DB is available).

### Step 2: Rewrite the browse search clause to use the indexes

1. Keep substring and case-insensitive semantics for both branches. The media
   expression must match migration 013. The category predicate must reach the
   base `categories.name` expression indexed in step 1; `lower(ac.name)` is
   computed from a recursive CTE and may not use that base-table index.
   One candidate is `m.category_id IN (SELECT id FROM categories WHERE
   lower(name) LIKE lower($n) ESCAPE '\\')`, still intersected with the
   existing accessible-category join. Preserve literal `%`, `_`, and `\\`
   escaping and the original OR behavior. Do not use similarity ranking.
2. Confirm with `EXPLAIN` on a seeded DB that both branches use bitmap/index
   scans for selective search terms. If no DB is available, verify the SQL
   expressions against both index definitions, but report the plan as
   `BLOCKED-needs-DB-verify` rather than claiming index use.
3. Update the search SQL-shape assertions in `media.test.js:137-139`.

**Verify**: `npm run test:server` → pass.

### Step 3: Add a complete paged loader to Admin

1. Implement one category-media loader for all three paths at
   `CategoryManager.jsx:137,194,341`. Request `limit=100&offset=0`, then
   advance by the number of returned rows until a page has fewer than 100.
   Preserve the array response and apply `orderMedia` only after all pages
   arrive. Check `response.ok` and array shape on every page; a failed later
   page must not publish a partial category as complete.
2. Preserve cancellation when the modal closes or changes category during a
   multi-page load. The collection count, edit/delete controls, and
   `EpisodeOrderModal` must see the complete array. Refresh after upload and
   track-order scan must also use the same loader. Keep the current fallback
   to locally completed uploads if a refresh fails.
3. Add Admin tests with 205 items (three pages) and exactly 100 items (an
   empty final request). Verify the full collection and video-order input,
   no partial publish after a later-page error, and stale loads do not replace
   a newly selected category. Update existing one-request mocks.

**Verify**: `npm run test:web` → pass.

### Step 4: Bound GET / with pagination

Add `limit` (default 100, max 100) and non-negative integer `offset` to
`GET /`. Keep the existing ordered-array response and ORDER BY; append
`LIMIT` and `OFFSET` using bound parameters after current filters. A page
shorter than `limit` signals the end. Reject malformed, negative, fractional,
or over-limit inputs with 400. Document `limit`/`offset` in a code comment.
For libraries under 100 items, a no-param response remains unchanged.
Re-audit direct list callers before switching the default cap on.

**Verify**: `npm run test:server` → all pass.

### Step 5: Add server equivalence and pagination tests

- Search-by-category-name returns the same rows before/after (equivalence).
- `GET /` with `limit` returns bounded results; invalid limit → 400.
- `GET /` `offset` returns the next ordered page, with no duplicate or missing
  rows across 100-item boundaries; invalid offset → 400.
- Updated SQL-shape assertion passes.

**Verify**: `npm run test:server` → all pass including new tests.

## Test plan

- Equivalence + pagination tests in `media.test.js`; 100/205-item Admin tests
  in `Admin.test.jsx` or a focused loader test.
- Full server and web suites green; lint clean. `EXPLAIN` evidence if a DB is
  available.

## Done criteria

- [ ] New migration file exists, applies cleanly, follows 013's style
- [ ] `npm run test:server` exits 0 with new tests passing
- [ ] `npm run test:web` exits 0; Admin displays and reorders all 205 items
      after paging, including upload and scan refresh paths
- [ ] `GET /` is bounded (limit validation present, no unbounded path remains)
- [ ] `npm run lint` exits 0
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- No dev DB is available AND the search rewrite can't be EXPLAIN-verified —
  still proceed with the index + expression alignment, but mark the plan
  BLOCKED-needs-DB-verify in your report rather than claiming victory.
- The search rewrite would change match semantics (ranking/relevance) — stop
  and report; relevance changes need a product decision.
- A newly discovered list caller still requires all rows and cannot be paged
  within the expanded scope — stop and report before applying the server cap.
- Verification fails twice after reasonable attempts.

## Maintenance notes

- The per-row `MEDIA_ENCODING_FIELDS` subqueries (`media.js:77-100`) remain
  the next browse bottleneck — future plan: batched CTE over paged IDs.
- Any new searchable text column must get a trigram index in the same
  migration style, or it will silently seq-scan.

## Execution notes (2026-10-06)

- Implemented migration `024_browse_category_trgm.sql`, category-name search
  predicate alignment, bounded `GET /api/media` pagination, and the Admin
  multi-page category loader with cancellation and refresh-path coverage.
- Server media tests: 43 passed; full server suite: 303 passed. Admin tests: 6
  passed; full web suite: 310 passed. Workspace lint passed.
- PostgreSQL was unavailable in the execution environment (`EPERM` connecting
  to `127.0.0.1:5432`), so migration application and `EXPLAIN` index evidence
  remain outstanding. Run `npm run migrate --workspace=server` and a selective
  browse `EXPLAIN` when a development database is available, then change the
  status to DONE if both succeed.
