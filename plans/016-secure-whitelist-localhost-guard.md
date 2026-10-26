# Plan 016: Historical whitelist route guard

> **Completed historical plan. Do not execute against current routes.** The
> original plan was written at commit `50f1f36` on 2026-09-22 and marked DONE.
> The `ip_whitelist` management route and localhost privilege model were
> removed when account authentication shipped.

## Original finding and disposition

The old auth hook guarded `/api/whitelist` by a raw URL prefix. Encoded route
paths could bypass that check, so the completed fix moved authorization to the
route itself. This is retained as security history, not a current endpoint or
an instruction to restore CIDR management.

## Current account flow

`server/src/plugins/auth.js` requires a Redis-backed account session for the
protected `/api` route group. It loads `request.user` from PostgreSQL and sets
`request.accessTier` from the account. Administrative operations must check
the authenticated account's tier and resource scope at the route boundary.
Neither localhost nor `request.networkIp` confers administrator privileges.
`request.clientIp` is a synthetic account key retained for some Redis contracts.

## Future security check

For a new admin route, test signed-out, tier-0, tier-100, and tier-999 account
requests, including encoded or normalized URL variants. Assert that the route
itself enforces its required tier and resource scope, and that network address
changes do not alter account privileges. Run `npm run test:server` and
`npm run lint --workspace=server`. If a future route really must be local-only,
specify that separately alongside account authentication; do not use the old
whitelist route or raw URL-prefix guard as a template.
