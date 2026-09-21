# Plan 008: Align Browse Search Query with GIN Trigram Index

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- server/src/routes/media.js server/src/routes/media.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

Migration `013_performance_indexes.sql` created a GIN trigram index:
`idx_media_assets_search_trgm ON media_assets USING gin ((lower(coalesce(title, '') || ' ' || coalesce(artists, '') || ' ' || coalesce(description, ''))) gin_trgm_ops)`.

However, in `server/src/routes/media.js:655-656`, the browse search WHERE clause appends the category name `ac.name` from the joined CTE table:
`lower(coalesce(m.title, '') || ' ' || coalesce(m.artists, '') || ' ' || coalesce(m.description, '') || ' ' || ac.name) LIKE lower($N)`.

Because the expression combines columns across two distinct tables (`media_assets` and `accessible_categories`), PostgreSQL cannot use the GIN index on `media_assets` and is forced to perform a full sequential table scan on every search query.

Fixing this by checking `ac.name` separately or indexing appropriately restores trigram index acceleration for media searches.

## Current state

- `server/src/routes/media.js:652-657`:
```javascript
    if (search) {
      const escapedSearch = search.replace(/[\\%_]/g, "\\$&");
      params.push(`%${escapedSearch}%`);
      clauses.push(`lower(coalesce(m.title, '') || ' ' || coalesce(m.artists, '') || ' '
        || coalesce(m.description, '') || ' ' || ac.name) LIKE lower($${params.length}) ESCAPE '\\'`);
    }
```
- `server/src/migrations/013_performance_indexes.sql:3-10`:
```sql
CREATE INDEX IF NOT EXISTS idx_media_assets_search_trgm
ON media_assets USING gin (
  (lower(coalesce(title, '') || ' ' || coalesce(artists, '') || ' ' || coalesce(description, '')))
  gin_trgm_ops
);
```

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `npm run test:server`    | exit 0, all pass    |
| Lint      | `npm run lint --workspace=server` | exit 0     |

## Scope

**In scope**:
- `server/src/routes/media.js`
- `server/src/routes/media.test.js`

**Out of scope**:
- Database schema and migration changes.

## Git workflow

- Branch: `advisor/008-optimize-browse-trigram-search`
- Commit message: `perf(media): leverage trigram index in browse search query`

## Steps

### Step 1: Split Search Clause into Indexed Media Search and Category Search

In `server/src/routes/media.js`:
- Rewrite the search filter to allow Postgres to utilize `idx_media_assets_search_trgm`:
```javascript
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
This enables Postgres query planner to use the GIN index for the first condition via Bitmap Index Scan and combine it with the category match.

### Step 2: Verify Search Endpoint Tests

Run `npm run test:server` to verify that existing search tests pass and return identical matching results.

## Done criteria

- [ ] `npm run lint --workspace=server` exits 0.
- [ ] `npm run test:server` exits 0.
- [ ] `idx_media_assets_search_trgm` can be utilized by PostgreSQL query planner.

## STOP conditions

- If search semantics require phrase matching crossing between media title and category name as a single contiguous token, report before changing.
