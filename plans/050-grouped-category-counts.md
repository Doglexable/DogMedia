# Plan 050: Replace correlated per-category counts with grouped aggregates

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/src/routes/categories.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `2bf8caa`, 2026-10-06

## Why this matters

Both category list and detail queries compute two correlated `COUNT(*)`
subqueries per returned row — 2N count queries' worth of work on every library
load, growing with tree size. A grouped pre-aggregation returns identical
columns in constant query shape. After this plan, category reads cost two
`GROUP BY` aggregates regardless of tree size.

## Current state

Relevant files:

- `server/src/routes/categories.js` — list (`:120-133`) and detail (`:135-162`).
- Category route tests (find the test file — check `server/src/routes/` for
  `categor*.test.js` before starting).

```sql
-- server/src/routes/categories.js:125-126 (list) and :149-150 (detail), identical pattern
(SELECT COUNT(*)::int FROM categories child WHERE child.parent_id = category_tree.id) AS child_count,
(SELECT COUNT(*)::int FROM media_assets media WHERE media.category_id = category_tree.id) AS media_count,
```

Both queries build on a `category_tree` CTE (recursive, tier-filtered —
read the full query including the CTE at the top of each handler before
editing). The `GET /:id` handler at `:157-161` has a 403/404 split that must
be preserved.

Repo conventions: `pg.query` with CTE + positional params, `::int` casts,
inject-pattern tests.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Server tests | `npm run test:server` | all pass |
| Lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:

- `server/src/routes/categories.js` (both queries only)
- Category route tests (extend)

**Out of scope**:

- Any other route's queries (browse/dashboard/wrapped counts are separate plans).
- Changing output columns, ordering, or the 403/404 behavior — byte-identical
  response shapes.
- The accessible-CTE dedup refactor — not this plan.

## Git workflow

- Branch: `advisor/050-category-count-aggregates`
- Conventional commits, e.g. `perf(server): pre-aggregate category child and media counts`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Rewrite list query with pre-aggregated counts

Replace the two correlated subselects in the list query with:

```sql
LEFT JOIN (SELECT parent_id, COUNT(*)::int AS child_count FROM categories GROUP BY parent_id) cc
  ON cc.parent_id = category_tree.id
LEFT JOIN (SELECT category_id, COUNT(*)::int AS media_count FROM media_assets GROUP BY category_id) mc
  ON mc.category_id = category_tree.id
```

and select `COALESCE(cc.child_count, 0) AS child_count`,
`COALESCE(mc.media_count, 0) AS media_count`. Semantics to preserve:
counts are over the *unfiltered* tables (the current subqueries ignore the
access tier — verify this by reading: the subqueries query base tables, not
the CTE — and keep it that way; changing to tier-filtered counts would alter
responses).

**Verify**: `npm run test:server` → category tests pass; manually diff a list
response before/after (write a quick throwaway script or test, do not commit it).

### Step 2: Apply the same rewrite to the detail query

Same replacement in `GET /:id` (`:149-150`), preserving the `:157-161`
403/404 split logic untouched.

**Verify**: `npm run test:server` → all pass.

### Step 3: Add equivalence tests

Add tests asserting `child_count`/`media_count` values on list and detail for
a fixture tree (categories with children + media, empty categories → 0, not
null). If the existing test file already covers counts, extend it; otherwise
add cases in the same style.

**Verify**: `npm run test:server` → all pass including new tests.

## Test plan

- Equivalence tests per step 3 in the category route test file.
- Full suite green; lint clean. Optional: `EXPLAIN` before/after on a seeded
  DB to confirm subplan removal (report, not required).

## Done criteria

- [ ] `npm run test:server` exits 0 with new count-equivalence tests passing
- [ ] `grep -n "SELECT COUNT" server/src/routes/categories.js` returns no matches
- [ ] Response shapes unchanged (same columns, zeros not nulls)
- [ ] `npm run lint --workspace=server` exits 0
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Excerpts don't match (drift).
- The counts turn out to be tier-filtered somewhere non-obvious — stop and
  report rather than silently changing semantics.
- Verification fails twice after reasonable attempts.

## Maintenance notes

- If a tier-filtered count is ever wanted, it must be a *new* column, not a
  change to these — clients depend on current semantics.
- Same correlated pattern exists in other routes (browse/dashboard); those are
  separate plans with their own verification.
