# Plan 052: Make browse search index-friendly and paginate media list

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/src/routes/media.js server/src/migrations server/src/routes/media.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `2bf8caa`, 2026-10-06

## Why this matters

Every browse keystroke pays a sequential scan (leading-`%` LIKE over a
concatenated expression plus an OR branch on an unindexed category name), and
`GET /api/media` has no pagination at all — unbounded full-library selects
with per-row encoding subqueries. After this plan, category-name searches hit
a trigram index, the media expression search uses the existing index
efficiently, and the list endpoint is bounded.

## Current state

Relevant files:

- `server/src/routes/media.js:50-100` — CTE + `MEDIA_ENCODING_FIELDS`
  (two correlated subqueries per row, inlined at `:601,698,729`).
- `server/src/routes/media.js:596-634` — `GET /` (no LIMIT).
- `server/src/routes/media.js:636-722` — `GET /browse` (limit ≤ 100, cursor;
  search at `:675-683`).
- `server/src/migrations/013_performance_indexes.sql:3-10` — trigram index on
  the media-concat expression only; nothing on `categories.name`.
- `server/src/routes/media.test.js:107` — asserts current SQL shape (will need
  updating; read it first).

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
| Lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:

- `server/src/migrations/0NN_*.md` — one new migration (next number; list the
  directory first): trigram index on `lower(categories.name)`.
- `server/src/routes/media.js` (`GET /browse` search clause; `GET /` pagination).
- `server/src/routes/media.test.js` (update SQL-shape assertions + new tests).

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

1. Split the OR into two indexable predicates: keep the media-expression
   `LIKE` (covered by the 013 index) and add the category-name `LIKE`
   (covered by the new index). Restructure so the planner can use both —
   e.g. keep the OR but ensure each branch matches its indexed expression
   exactly (same `lower(...)` shape as the index definition), or use
   `similarity()` ordering only if match semantics stay substring-identical.
   Simplest acceptable change: preserve the OR but align both branches with
   their index expressions.
2. Confirm with `EXPLAIN` on a seeded DB that both branches use bitmap/index
   scans; if no DB is available, at least verify expression-for-expression
   alignment with the two index definitions by quoting both in your report.
3. Update `media.test.js:107` SQL-shape assertion to the new clause.

**Verify**: `npm run test:server` → pass.

### Step 3: Bound GET / with pagination

Add `limit` (default 100, max 100 — mirror `/browse`'s validation at
`media.js:637-640`) and cursor/offset pagination to `GET /`. Reuse the
`/browse` cursor helpers (`encodeBrowseCursor`/`decodeBrowseCursor`) if they
fit the `GET /` ordering (same ORDER BY at `:626-630` — check); otherwise use
plain `LIMIT/OFFSET` with validation. Keep the default (no params) response
identical for libraries under the default limit so existing clients don't
break; document the new params in a code comment.

Check web/mobile callers of `GET /api/media` for unbounded reliance (grep
`api/media` in `web/src` and `mobile/src`): if any caller needs all rows, it
must page — list affected callers in your report but do NOT change client code
(out of scope); choose a default limit large enough to avoid breaking them and
note it.

**Verify**: `npm run test:server` → all pass.

### Step 4: Add tests

- Search-by-category-name returns the same rows before/after (equivalence).
- `GET /` with `limit` returns bounded results; invalid limit → 400.
- Updated SQL-shape assertion passes.

**Verify**: `npm run test:server` → all pass including new tests.

## Test plan

- Equivalence + pagination tests in `media.test.js`.
- Full suite green; lint clean. `EXPLAIN` evidence if a DB is available.

## Done criteria

- [ ] New migration file exists, applies cleanly, follows 013's style
- [ ] `npm run test:server` exits 0 with new tests passing
- [ ] `GET /` is bounded (limit validation present, no unbounded path remains)
- [ ] `npm run lint --workspace=server` exits 0
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- No dev DB is available AND the search rewrite can't be EXPLAIN-verified —
  still proceed with the index + expression alignment, but mark the plan
  BLOCKED-needs-DB-verify in your report rather than claiming victory.
- The search rewrite would change match semantics (ranking/relevance) — stop
  and report; relevance changes need a product decision.
- `GET /` callers in web/mobile fundamentally require unbounded responses —
  stop and report instead of breaking them.
- Verification fails twice after reasonable attempts.

## Maintenance notes

- The per-row `MEDIA_ENCODING_FIELDS` subqueries (`media.js:77-100`) remain
  the next browse bottleneck — future plan: batched CTE over paged IDs.
- Any new searchable text column must get a trigram index in the same
  migration style, or it will silently seq-scan.
