# Plan 049: Validate whitelist writes and resource id params

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/src/routes/whitelist.js server/src/routes/media.js server/src/routes/queue.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/045-scope-media-mutations-to-accessible-categories.md
  (both edit `server/src/routes/media.js` — serialize to avoid conflicts;
  re-run the drift check)
- **Category**: security
- **Planned at**: commit `2bf8caa`, 2026-10-06

## Why this matters

Malformed ids on five routes surface 500s (pg `22P02`) instead of 400/404 —
breaking clients and widening the internal-error surface (there is no global
`setErrorHandler` in `server/src/index.js`). Localhost whitelist writes accept
unvalidated CIDR/tier values, 500ing on bad input instead of a clean 400 and
accepting nonsense tiers on the happy path. After this plan, bad input gets
400s everywhere and whitelist rows are validated before insert.

## Current state

Relevant files:

- `server/src/routes/whitelist.js:20-31` — POST inserts raw values:

```js
fastify.post("/", async (request, reply) => {
  const { cidr_range, access_tier, description } = request.body;
  if (!cidr_range) {
    return reply.code(400).send({ error: "cidr_range is required" });
  }
  const { rows } = await fastify.pg.query(
    "INSERT INTO ip_whitelist (cidr_range, access_tier, description) VALUES ($1, $2, $3) RETURNING *",
    [cidr_range, access_tier ?? 0, description ?? null]
  );
```

(The `cidr_range` column is `CIDR NOT NULL` per
`server/src/migrations/001_initial.sql:22`, so malformed input throws → 500.
The localhost preHandler guard at `whitelist.js:2-11` stays as-is.)

Raw-id params passed straight to integer columns (verified 2026-10-06):

- `server/src/routes/media.js:724` (`GET /:id`, `[request.accessTier, id]`)
- `server/src/routes/media.js:1275`+ (stream path, same pattern)
- `server/src/routes/media.js:1402`+ (thumbnail path, same pattern)
- `server/src/routes/queue.js:636` (`POST /auto/:categoryId`)
- `server/src/routes/whitelist.js:33-41` (`DELETE /:id`, raw `id`)

Note the browse route already validates ints this way — copy its style:

```js
// server/src/routes/media.js:642-647 — exemplar to match
const categoryId = request.query?.category_id == null
  ? null
  : Number.parseInt(request.query.category_id, 10);
if (request.query?.category_id != null && (!Number.isInteger(categoryId) || categoryId < 1)) {
  return reply.code(400).send({ error: "Invalid category_id" });
}
```

Repo conventions: `reply.code(400).send({ error: "..." })`, inject-pattern tests.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Server tests | `npm run test:server` | all pass |
| Lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:

- `server/src/routes/whitelist.js` (POST validation; DELETE id validation)
- `server/src/routes/media.js` (id validation on `GET /:id`, stream,
  thumbnail — and PUT/DELETE/retry only if plan 045 hasn't already covered
  their id parsing; do not duplicate its work)
- `server/src/routes/queue.js` (`POST /auto/:categoryId` validation)
- New or extended `*.test.js` files for the above

**Out of scope**:

- A global `setErrorHandler` — deliberately not this plan (per-route 400s are
  explicit and testable; a global handler can mask bugs).
- Category-tier scoping itself — plan 045.
- Changing valid-input behavior or response shapes.

## Git workflow

- Branch: `advisor/049-input-id-whitelist-validation`
- Conventional commits, e.g. `fix(server): validate whitelist writes and resource ids`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Validate whitelist POST and DELETE id

1. `POST /` (`whitelist.js:20`): validate `cidr_range` parses as a CIDR
   (use Postgres itself: `SELECT $1::cidr` in a try/catch mapped to 400, or a
   JS CIDR check if a dep already exists — do NOT add a new dependency for
   this; prefer the `::cidr` cast probe). Validate `access_tier` is an integer
   within the known tier set (check what tiers the codebase uses: 0, 50, 100,
   999 appear in README/seed code — accept any non-negative integer if no
   closed set is documented; read first, then decide and document the choice
   in a code comment).
   - Invalid → `400` with a specific message; valid → unchanged 201 path.
2. `DELETE /:id` (`whitelist.js:33`): non-integer id → 400 (same
   `Number.parseInt` + `Number.isInteger` pattern as the exemplar).

**Verify**: `npm run test:server` → pass.

### Step 2: Gate numeric resource ids in media and queue routes

At each site (`media.js` `GET /:id`, stream, thumbnail; `queue.js`
`POST /auto/:categoryId`): parse with `Number.parseInt`, reject
non-integers/`< 1` with `400` before any `pg.query`. Copy the browse-route
exemplar above verbatim in style. If plan 045 already added parsing to
PUT/DELETE/retry, skip those — check first.

**Verify**: `npm run test:server` → pass.

### Step 3: Add regression tests

- `GET /api/media/abc` → 400 (not 500). Same for stream and thumbnail paths.
- `POST /api/queue/auto/abc` → 400.
- `POST /api/whitelist` with `cidr_range: "not-a-cidr"` → 400, no row inserted.
- `POST /api/whitelist` with `access_tier: "admin"` (or negative) → 400.
- `DELETE /api/whitelist/abc` → 400.
- Happy paths unchanged (valid ids/CIDR still work).

**Verify**: `npm run test:server` → all pass including new tests.

## Test plan

- New tests per step 3 in the existing route test files (or a new
  `whitelist.test.js` if none exists — check first).
- Full suite green; lint clean.

## Done criteria

- [ ] `npm run test:server` exits 0 with new 400-validation tests passing
- [ ] Requesting any in-scope route with a non-numeric id returns 400, never 500
- [ ] Malformed whitelist writes return 400 without inserting
- [ ] `npm run lint --workspace=server` exits 0
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Current-state excerpts don't match live code (e.g. plan 045 already added
  id parsing — then skip those sites, note it in the commit).
- No reasonable CIDR validation is possible without a new dependency — stop
  and report rather than adding one silently.
- Verification fails twice after reasonable attempts.

## Maintenance notes

- New routes with `:id` params must validate before querying — reviewer
  checklist item. A shared `parseResourceId()` helper is a reasonable future
  extraction once 3+ routes use the inline pattern (do NOT build it here —
  copy the exemplar to keep the diff reviewable).
