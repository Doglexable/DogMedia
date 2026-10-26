# Plan 067: Scope category mutations to the caller's accessible tree

> **Executor instructions**: Follow each step and gate below. Update only this plan's row in `plans/README.md` when done. Stop on the listed conditions instead of broadening scope.
>
> **Drift check first**: `git diff --stat d436e4f..HEAD -- server/src/routes/categories.js server/src/routes/categories.test.js`. If either file changed, compare the excerpts below with the live code and stop on a mismatch.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED; category moves and tier propagation affect entire subtrees.
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `d436e4f`, 2026-10-26

## Why this matters

Category reads are restricted by the caller's access tier, but write routes check only whether that tier is at least 100. A tier 100 administrator can therefore modify a category hidden at tier 999, lower its tier, move it, change its cover, or delete it by ID. The same boundary already applies to media mutations in `server/src/routes/media.js`; categories should enforce it too.

## Current state

- `server/src/routes/categories.js:10-44` defines `CATEGORY_TREE_SQL`, whose recursive branch includes only roots and descendants with `min_access_tier <= $1`. GET detail uses it at lines 139-169.
- `server/src/routes/categories.js:57-70` has unscoped helpers:
  ```js
  "SELECT id, parent_id, min_access_tier, sort_order, cover_path FROM categories WHERE id = $1"
  "SELECT min_access_tier FROM categories WHERE id = $1"
  ```
- `server/src/routes/categories.js:172-203` creates categories under any existing parent; `:225-271` writes/deletes a cover; `:274-323` edits any category and propagates its tier; `:326-453` moves any category in a transaction; `:455-475` deletes any category.
- `server/src/routes/categories.test.js` uses Fastify `inject` and a mocked `pg.query`. Follow that test style. The existing GET behavior distinguishes 403 for an existing but inaccessible category from 404 for a missing category; preserve it.
- `AGENTS.md` defines tier 100+ as admin access and tier 999 as the seeded administrator. Category tier controls visibility; the plan does not introduce a new role model.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm run test:server -- --run src/routes/categories.test.js` | exit 0; all category tests pass |
| Server lint | `npm run lint --workspace=server` | exit 0 |
| Full server tests | `npm run test:server` | exit 0 |

## Scope

**In scope**: `server/src/routes/categories.js`, `server/src/routes/categories.test.js`, this plan's row in `plans/README.md`.

**Out of scope**: media routes, auth tiers, database schema, frontend category UI, category-cover image transformation, and changes to response payload shapes.

## Git workflow

Use a branch named `advisor/067-scope-category-mutations`. Recent commits use conventional messages such as `fix(web): prevent library view transition rows from overlapping mini player`; use `fix(server): scope category mutations to accessible tree`. Do not push or open a PR without operator instruction.

## Steps

### Step 1: Add denied-write regression tests

In `categories.test.js`, add `inject` cases with an accessible root, an inaccessible root, and an inaccessible descendant of an accessible root. Exercise POST under a hidden parent, PUT and DELETE on a hidden category, PUT/DELETE thumbnail on a hidden category, and PATCH move from or into a hidden category. Assert 403, zero writes, and no file deletion; include a missing ID case that remains 404 where the existing route distinguishes existence. Add allowed tier 999 cases for at least one mutation and move. Use request-tier hook and SQL-aware mock behavior, not a mock that returns a result for every query regardless of tier.

**Verify**: `npm run test:server -- --run src/routes/categories.test.js` → new denial tests fail against the old implementation for the intended access reason.

### Step 2: Enforce access on every category mutation

Add a helper in `categories.js` that looks up a category by ID through `CATEGORY_TREE_SQL` with `request.accessTier`. Use it for the target category and any parent selected by POST, PUT, or PATCH. Keep the existing 403 versus 404 convention: an existing but inaccessible ID yields 403, a nonexistent ID yields 404 for target lookups (parent errors may retain the current 400 shape if tests depend on it, but must not reveal or use a hidden parent). For PATCH, perform the access check inside the existing transaction and use its client, so the check and move share one database snapshot. Ensure tier 100 cannot use a visible source moved into a hidden parent to make that hidden subtree visible. Covers and deletion must check before touching disk or database.

**Verify**: `npm run test:server -- --run src/routes/categories.test.js` → denied requests perform no mutation; allowed cases pass.

### Step 3: Verify the server surface

Run lint and the server suite. Inspect every category write route in `categories.js` once more for an unscoped target or parent lookup and keep the existing tier propagation semantics for allowed moves.

**Verify**: `npm run lint --workspace=server && npm run test:server` → both exit 0.

## Test plan

Use `server/src/routes/categories.test.js` as the structural pattern. The new assertions must cover hidden target, hidden ancestor, hidden destination parent, allowed tier 999 mutation, and 404 for nonexistent target. A denied cover/delete test must prove no filesystem removal. Avoid tests that merely inspect SQL strings without exercising the route's return code and write count.

## Done criteria

- [ ] Focused category tests, server lint, and full server tests exit 0.
- [ ] All six write route families (create, edit, move, cover upload, cover delete, category delete) reject inaccessible target/parent IDs.
- [ ] No files outside Scope are modified, except the plan status row.

## STOP conditions

- A category write is intentionally specified elsewhere as globally available to every tier 100+ admin, regardless of category visibility. Report that policy conflict before changing behavior.
- The access check requires a database migration or changes to media routes.
- The current code no longer matches the excerpts after drift review, or a gate fails twice.

## Maintenance notes

Future category write routes must use the same recursive access boundary. Review access checks inside transactions for moves and the filesystem order for cover/deletion paths.
