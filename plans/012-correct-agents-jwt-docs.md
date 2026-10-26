# Plan 012: Correct authentication documentation

> **Completed historical plan. Do not execute the original IP whitelist
> instructions.** This plan was written at commit `1cb3b29` on 2026-09-21 and
> marked DONE before account authentication shipped.

## Original finding

`AGENTS.md` claimed the server used JWT authentication and a `PFS_JWT_SECRET`.
That did not match the implementation at the time. The documentation correction
was completed, and the authentication architecture changed again afterward.

## Current account flow

`server/src/plugins/auth.js` provides username/password registration and login.
It stores a digest-keyed session in Redis and accepts the `pfs_session` cookie
or a Bearer token on protected requests. The hook loads `users.id`, sets
`request.user` and `request.accessTier`, and rejects missing, expired, or
revoked sessions with `LOGIN_REQUIRED`. `GET /api/check-access` reports the
authenticated account and tier. `request.networkIp` is for network controls;
it does not grant an access tier. JWT and IP whitelist instructions are obsolete.

## Documentation handoff if drift returns

Compare `AGENTS.md`, `README.md`, and any client auth instructions with
`server/src/plugins/auth.js`, `server/src/routes/check-access.js`, and the
current `users` migrations. Describe the registration/login flow, session
storage, logout, tier checks, and password-change revocation. Verify with
`rg -n 'JWT|PFS_JWT_SECRET|ip_whitelist|whitelist' AGENTS.md README.md` and
`npm run test:server -- auth`. Update docs only if they diverge from those
sources; do not restore the old IP authorization model.
