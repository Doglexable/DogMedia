# Plan 049: Validate numeric resource IDs (historical account migration note)

> **Completed historical plan. Do not execute the retired whitelist portion.**
> Written at commit `2bf8caa` on 2026-10-06, after Plan 045; marked DONE.

## Original finding and completed work

Malformed numeric IDs in media and queue routes could reach integer database
columns and return 500 instead of 400. The completed work added route-level
validation and tests. The same plan also validated writes to the former
`ip_whitelist` management route. That endpoint was removed during the move to
username/password accounts; its CIDR/tier validation is now historical only.

## Current contract

`server/src/plugins/auth.js` authenticates via a Redis-backed account session
and loads `request.user.id` and `request.accessTier`. Protected media and queue
routes must validate `:id` and `:categoryId` before querying PostgreSQL,
return a structured 400 for malformed IDs, and apply account tier and category
access checks to valid IDs. Network IP and localhost do not grant access.

## Future validation handoff

For new numeric resource parameters, add focused Fastify route tests for
letters, zero, negative numbers, and valid positive IDs. Verify that malformed
input returns 400 without a database query, while valid but inaccessible
resources follow the route's existing 403/404 policy. Use the existing
`server/src/routes/media.test.js` and `server/src/routes/queue.test.js` patterns.
Run `npm run test:server` and `npm run lint --workspace=server`. Keep auth and
resource-scope assertions under real account fixtures, not a simulated
whitelisted source address.
