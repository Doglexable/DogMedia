# Plan 016: Secure IP Whitelist Routes with Route-Level Localhost Authorization

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 50f1f36..HEAD -- server/src/plugins/auth.js server/src/routes/whitelist.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/015-fix-site-footer-rgb-tokens.md
- **Category**: security
- **Planned at**: commit `50f1f36`, 2026-09-22

## Why this matters

DogMedia uses IP-based authentication without user logins or passwords. Management of the `ip_whitelist` table (which grants guest, standard, and administrator privileges up to tier 999) must be strictly confined to localhost. Currently, the localhost check in `server/src/plugins/auth.js` relies solely on `request.url.startsWith("/api/whitelist")`. Because Fastify's router decodes percent-encoded URLs, an attacker on the local network (tier 0) can send requests to `/api/%77hitelist` or `/api//whitelist`. This bypasses the prefix check in `auth.js`, passes the standard subnet check, and reaches `whitelistRoutes`, allowing unauthorized clients to inspect all whitelisted subnets, create admin CIDR entries (`access_tier: 999`), or delete whitelist rules. Moving localhost enforcement into a dedicated `preHandler` hook in `server/src/routes/whitelist.js` and decoding paths in `auth.js` eliminates this bypass completely.

## Current state

The relevant files:
- `server/src/plugins/auth.js` — global `onRequest` auth plugin performing IP resolution, CIDR matching, and naive string prefix checking.
- `server/src/routes/whitelist.js` — route definitions for `GET /`, `POST /`, and `DELETE /:id` on the IP whitelist.

Current-state excerpts:
`server/src/plugins/auth.js:143-152`:
```javascript
    if (request.url.startsWith("/api/whitelist")) {
      if (
        clientIp !== "127.0.0.1" &&
        clientIp !== "::1" &&
        clientIp !== "::ffff:127.0.0.1"
      ) {
        return reply.code(403).send({ error: "Only accessible from localhost" });
      }
      return;
    }
```

`server/src/routes/whitelist.js:1-7`:
```javascript
export default async function (fastify) {
  fastify.get("/", async () => {
    const { rows } = await fastify.pg.query(
      "SELECT * FROM ip_whitelist ORDER BY cidr_range"
    );
    return rows;
  });
```

Repo conventions:
- Localhost IPs are recognized as `"127.0.0.1"`, `"::1"`, or `"::ffff:127.0.0.1"`.
- Fastify route plugins use `fastify.addHook("preHandler", ...)` for route-scoped authorization.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server tests | `npm run test:server` | all pass |
| Whitelist test only | `npm run test:server -- whitelist.test.js` | all pass |
| Server lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:
- `server/src/routes/whitelist.js` — add route-scoped `preHandler` verifying localhost.
- `server/src/plugins/auth.js` — normalize and decode URL path before prefix checks.
- `server/src/routes/whitelist.test.js` (create) — unit/integration tests for whitelist routes and authorization gates.

**Out of scope**:
- Changing the schema of `ip_whitelist` table.
- Modifying CIDR matching logic in `auth.js` for non-whitelist routes.

## Git workflow

- Branch: `advisor/016-secure-whitelist-localhost-guard`
- Commit style: `fix(server): enforce route-level localhost authorization on whitelist routes`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add route-level localhost check in `server/src/routes/whitelist.js`

Open `server/src/routes/whitelist.js`. At the top of the plugin function, register a `preHandler` hook:

```javascript
export default async function (fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    const clientIp = request.clientIp || request.ip;
    if (
      clientIp !== "127.0.0.1" &&
      clientIp !== "::1" &&
      clientIp !== "::ffff:127.0.0.1"
    ) {
      return reply.code(403).send({ error: "Only accessible from localhost" });
    }
  });

  fastify.get("/", async () => {
    // existing route handlers...
```

### Step 2: Normalize request path in `server/src/plugins/auth.js`

Open `server/src/plugins/auth.js`. In the `onRequest` hook (around line 143), decode and normalize the path before evaluating the prefix:

```javascript
    const rawPath = request.url.split("?")[0];
    let normalizedPath;
    try {
      normalizedPath = decodeURIComponent(rawPath);
    } catch {
      normalizedPath = rawPath;
    }

    if (normalizedPath === "/api/whitelist" || normalizedPath.startsWith("/api/whitelist/")) {
      if (
        clientIp !== "127.0.0.1" &&
        clientIp !== "::1" &&
        clientIp !== "::ffff:127.0.0.1"
      ) {
        return reply.code(403).send({ error: "Only accessible from localhost" });
      }
      return;
    }
```

### Step 3: Create automated tests in `server/src/routes/whitelist.test.js`

Create `server/src/routes/whitelist.test.js` using Fastify `inject()`:
- Test 1: Remote IP (e.g. `192.168.1.50`) requesting `GET /api/whitelist` receives 403 Forbidden.
- Test 2: Remote IP requesting `GET /api/%77hitelist` or `GET /api/./whitelist` receives 403 Forbidden.
- Test 3: Localhost (`127.0.0.1`) requesting `GET /api/whitelist` receives 200 OK and returns rows.
- Test 4: Localhost requesting `POST /api/whitelist` inserts a new CIDR range and calls `clearAuthCache`.
- Test 5: Localhost requesting `DELETE /api/whitelist/:id` deletes entry and calls `clearAuthCache`.

**Verify**: `npm run test:server -- whitelist.test.js` → all tests pass.

## Test plan

- Verify unauthorized remote IPs cannot view or modify whitelist rules even when using percent-encoding or path traversal tricks.
- Verify localhost requests succeed and clear the auth cache.
- Run `npm run test:server` and verify all existing tests continue to pass.

## Done criteria

- [ ] `GET /api/%77hitelist` returns 403 when called from a non-localhost IP
- [ ] `POST /api/%77hitelist` returns 403 when called from a non-localhost IP
- [ ] `npm run test:server -- whitelist.test.js` exits 0
- [ ] `npm run lint --workspace=server` exits 0
- [ ] No files outside `server/src/routes/whitelist.js`, `server/src/plugins/auth.js`, and `server/src/routes/whitelist.test.js` are modified

## STOP conditions

- If Fastify routing fails to pass requests with decoded paths to the plugin.
- If existing localhost admin workflows in `web/` break during legitimate localhost management.

## Maintenance notes

- Any new admin-only system routes (such as server diagnostics or secret configuration) must use route-level `preHandler` hooks rather than relying on URL string prefix checks in global hooks.
