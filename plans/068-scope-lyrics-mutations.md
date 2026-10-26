# Plan 068: Restrict lyrics writes to accessible media

> **Executor instructions**: Follow the steps and gates below. Update this plan's status row in `plans/README.md` when complete. Stop at the listed conditions.
>
> **Drift check first**: `git diff --stat d436e4f..HEAD -- server/src/routes/lyrics.js server/src/routes/lyrics.test.js`. If the route changed, compare the excerpts below with live code and stop on a mismatch.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW; only denied writes should change.
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `d436e4f`, 2026-10-26

## Why this matters

The lyrics GET route uses the recursive category access query. The PUT and DELETE routes accept any media ID once the caller has tier 100, including media visible only to tier 999. That lets an administrator overwrite or remove lyrics for a media item they cannot read.

## Current state

- `server/src/routes/lyrics.js:10-38` defines `ACCESSIBLE_MEDIA_SQL` using accessible roots and descendants; it selects `m.id AS media_id` and joins media lyrics.
- The GET handler uses `fastify.pg.query(ACCESSIBLE_MEDIA_SQL, [request.accessTier, request.params.id])` at `:151-153`, then `sendMissingMedia` at `:144-148` to return 404 for missing media and 403 for inaccessible media.
- PUT at `:190-194` uses:
  ```js
  const { rowCount } = await fastify.pg.query("SELECT 1 FROM media_assets WHERE id = $1", [request.params.id]);
  if (rowCount === 0) return reply.code(404).send({ error: "Media not found" });
  const row = await upsertUploadedLyrics(fastify.pg, request.params.id, lyrics);
  ```
- DELETE at `:197-204` only checks `request.accessTier < 100`, then executes `DELETE FROM media_lyrics WHERE media_id = $1`.
- `server/src/lyrics.test.js` covers pure normalization/persistence helpers. Model route tests on Fastify `inject` tests in `server/src/routes/media.test.js`; create `server/src/routes/lyrics.test.js` for handler behavior.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused route tests | `npm run test:server -- --run src/routes/lyrics.test.js` | exit 0 after implementation |
| Server lint | `npm run lint --workspace=server` | exit 0 |
| Full server suite | `npm run test:server` | exit 0 |

## Scope

**In scope**: `server/src/routes/lyrics.js`, new `server/src/routes/lyrics.test.js`, this plan's row in `plans/README.md`.

**Out of scope**: LRCLIB lookup/cache policy, `server/src/lyrics.js` normalization, media routes, auth tiers, database schema, and any UI.

## Git workflow

Use `advisor/068-scope-lyrics-mutations`; commit in the repository's conventional style, e.g. `fix(server): scope lyrics writes to accessible media`. Do not push or open a PR without operator instruction.

## Steps

### Step 1: Capture the access behavior

Create `server/src/routes/lyrics.test.js` with Fastify `inject`, an `onRequest` hook that sets `accessTier`, and a deterministic `pg.query` mock. Test tier 0 PUT/DELETE return 403; tier 100 PUT/DELETE on tier 999 media return 403 with no INSERT/UPDATE/DELETE; nonexistent media returns 404; tier 999 can PUT and DELETE existing lyrics. Provide a valid Whisper body shaped like the `normalizeWhisperLyrics` cases in `server/src/lyrics.test.js`.

**Verify**: `npm run test:server -- --run src/routes/lyrics.test.js` → denial cases fail against the old route for the intended access reason.

### Step 2: Apply the existing read boundary before writes

Use `ACCESSIBLE_MEDIA_SQL` for the PUT and DELETE target lookup, passing the caller tier and media ID as GET does. If there is no accessible row, return `sendMissingMedia(...)` before calling `upsertUploadedLyrics` or deleting. Keep PUT validation errors as 400 and preserve successful payloads. For DELETE, preserve 404 when media exists and is accessible but has no lyrics. If a read-before-delete race is material, make the DELETE query itself conditional on the accessible media CTE, while retaining the same 403/404 semantics.

**Verify**: `npm run test:server -- --run src/routes/lyrics.test.js` → all access and success cases pass.

### Step 3: Check the server suite

Run lint and all server tests. Confirm the GET route's provider behavior and response shape remain untouched.

**Verify**: `npm run lint --workspace=server && npm run test:server` → exit 0.

## Test plan

Use the Fastify route test pattern in `server/src/routes/media.test.js`. Assert both HTTP status and absence of mutation SQL for denied cases. Cover a restricted descendant of an accessible root, not only a restricted root; the recursive access semantics are load bearing.

## Done criteria

- [ ] Focused route tests, lint, and full server tests exit 0.
- [ ] PUT and DELETE return 403 without mutation for an existing inaccessible media ID, 404 for a missing ID, and retain successful tier 999 behavior.
- [ ] Only scoped files and this plan's index row change.

## STOP conditions

- A documented policy explicitly grants all tier 100+ administrators global lyrics mutation rights.
- The fix requires changing the lyrics response contract, schema, or unrelated media routes.
- Drift check mismatches or a gate fails twice.

## Maintenance notes

Any future lyrics write endpoint must use the same accessible-media boundary. Review the SQL mutation, not only a preliminary lookup, if concurrent category moves become a concern.
