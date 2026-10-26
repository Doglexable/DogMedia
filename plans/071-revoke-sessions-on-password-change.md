# Plan 071: Revoke older account sessions when the password changes

> **Account-socket handoff (2026-10-26):** This completed plan invalidates
> previous Redis-backed sessions at the HTTP auth hook. An already-open
> playback WebSocket retains ticket identity and needs its own revocation
> check. Plan 041's Current continuation section owns that remaining work;
> do not assume an established socket closes solely because this plan is DONE.

> **Executor instructions**: Follow every step and gate. Update only this plan's status row in `plans/README.md` when done. Stop on the conditions below.
>
> **Drift check first**: `git diff --stat d436e4f..HEAD -- server/src/plugins/auth.js server/src/plugins/auth.test.js server/src/migrations/031_user_session_version.sql`. Compare changed files with the excerpts below and stop on a mismatch.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED; auth changes can log out clients, and migration must precede server rollout.
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `d436e4f`, 2026-10-26

## Why this matters

Changing an account password updates only `users.password_hash`. Existing Redis sessions remain keyed by bearer token for 30 days, and the auth hook accepts them as long as the user exists. Password changes should invalidate sessions issued before the change, so an old token does not retain access after account recovery or credential rotation.

## Current state

- `server/src/plugins/auth.js:7` defines `SESSION_SECONDS = 30 * 24 * 60 * 60`; `:39-41` hashes each token into a Redis key.
- `server/src/plugins/auth.js:68-73` starts a session with `await fastify.redis.set(tokenKey(token), String(user.id), "EX", SESSION_SECONDS)` and returns `{ token, user }`.
- `server/src/plugins/auth.js:82-94` reads the Redis value, selects the user by ID, and grants the current tier without checking when the token was issued.
- `server/src/plugins/auth.js:193-228` updates password hash in `PUT /auth/profile`, then returns the same response shape. Current web and mobile callers expect the existing session to remain usable after a profile edit; retain the current token when a password is changed while invalidating other tokens.
  ```js
  const userId = await fastify.redis.get(tokenKey(token));
  const { rows } = await fastify.pg.query("SELECT id, username, access_tier, profile_picture FROM users WHERE id = $1", [userId]);
  // Profile update currently writes password_hash without a session revocation field.
  ```
- `server/src/plugins/auth.test.js:6-47` has in-memory users and Redis sessions; `:110-160` tests profile changes but does not check prior tokens. Extend this fixture and test.
- `server/src/migrations/030_user_profile_picture.sql` is the latest numbered migration; `server/src/migrate.js:13-40` runs numbered migrations in transactions. Add `031_user_session_version.sql` in the same pattern.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused auth tests | `npm run test:server -- --run src/plugins/auth.test.js` | exit 0 |
| Migration runner tests | `npm run test:server -- --run src/migrate.test.js` | exit 0 |
| Server lint | `npm run lint --workspace=server` | exit 0 |
| Server suite | `npm run test:server` | exit 0 |
| Real DB migration | `npm run migrate --workspace=server` | exits 0 when local PostgreSQL is available; do not start a database solely for this plan |

## Scope

**In scope**: `server/src/plugins/auth.js`, `server/src/plugins/auth.test.js`, new `server/src/migrations/031_user_session_version.sql`, this plan's row in `plans/README.md`.

**Out of scope**: web/mobile/desktop profile UI, password policy, cookie attributes, account creation UX, Redis keyspace scans, old IP archive accounts, and changes to auth response shapes.

## Git workflow

Use `advisor/071-revoke-sessions-on-password-change`; commit in conventional style, e.g. `fix(auth): invalidate prior sessions after password change`. Do not push or open a PR without operator instruction. Deploy the migration before a server image that selects the new column.

## Steps

### Step 1: Test the session lifecycle

Extend the fixture in `auth.test.js` with a session version field and a second simultaneous login for one user. After a successful password change through the first token, assert the first token still gets 200 from `/auth/profile`, the older second token gets 401 with `LOGIN_REQUIRED`, a new login with the new password works, and the old password fails. Assert a username-only or profile-picture-only edit does not revoke the second token. Keep logout behavior intact.

**Verify**: `npm run test:server -- --run src/plugins/auth.test.js` → the new old-token denial case fails against the old implementation for the intended reason.

### Step 2: Add a durable per-user version

Create `031_user_session_version.sql` with a non-null integer `users.session_version` defaulting to zero. Store `userId:sessionVersion` in each new Redis session value, and select `session_version` in registration/login/auth/profile queries as needed. The auth hook must compare the stored version with the database version before granting access. Treat existing legacy Redis values containing only a user ID as version zero so deployment does not log out every user immediately; version one or later invalidates them after a password change. Reject malformed Redis values as expired sessions.

**Verify**: `npm run test:server -- --run src/plugins/auth.test.js src/migrate.test.js` → new session and legacy-token tests pass; migration runner tests exit 0.

### Step 3: Increment on password change and retain only the initiating token

In the password-changing `UPDATE users`, atomically increment `session_version`; do not increment for username or profile-picture edits. After the database update succeeds, update only `request.authToken`'s Redis value to the new version while preserving its existing TTL (Redis `SET ... KEEPTTL` or an equivalent atomic operation). The other session values still carry the prior version and fail the auth hook. If the Redis update fails, do not roll the database version back; old tokens must remain invalid. Return a clear server error so the user can log in again. Preserve the existing `{ ok, user }` response for success.

**Verify**: `npm run test:server -- --run src/plugins/auth.test.js` → old token 401, initiating token 200, non-password edit leaves both valid.

### Step 4: Verify migration and server behavior

Run lint and the full server suite. If a local PostgreSQL instance is already available and configured, run the migration command and verify it completes. Record a blocked DB verification in the plan row if PostgreSQL is unavailable; do not claim the migration ran from mock tests alone.

**Verify**: `npm run lint --workspace=server && npm run test:server` → exit 0. If run, `npm run migrate --workspace=server` → exits 0.

## Test plan

Model the test on `server/src/plugins/auth.test.js:110-160`. Exercise two tokens for the same user, legacy Redis values, password change, profile-only change, logout, malformed session value, and failed Redis rebind. The test must assert HTTP status and the `LOGIN_REQUIRED` code, not only inspect stored values. `server/src/migrate.test.js` is the migration runner pattern; a real DB migration check remains separate.

## Done criteria

- [ ] Focused auth and migration-runner tests, server lint, and full server tests exit 0.
- [ ] A password change invalidates all earlier tokens except the initiating token; non-password profile edits do not revoke sessions.
- [ ] Migration is documented as executed or explicitly marked pending real-DB verification.
- [ ] Only scoped source files, migration, and this plan's index row change.

## STOP conditions

- The current clients cannot keep using their existing cookie/bearer token after a Redis value rebind.
- The migration cannot be applied safely before the updated server starts.
- The required behavior is to revoke even the initiating session; clarify that policy before altering client flows.
- Drift review mismatches or a gate fails twice.

## Maintenance notes

Future ways to change passwords must increment the same session version. Keep legacy value parsing until all pre-migration sessions have expired (at most 30 days), then it can be removed in a separate cleanup. Review database/Redis failure ordering carefully; a failed rebind may require the initiating user to log in again but must never leave old tokens valid. The HTTP hook does not re-run on an established WebSocket; Plan 041 must revalidate before socket renewal or state writes.
