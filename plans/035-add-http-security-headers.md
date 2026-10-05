# Plan 035: Add HTTP security headers to prevent clickjacking and MIME sniffing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat edc7905..HEAD -- web/nginx.conf server/src/index.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `edc7905`, 2026-10-04

## Why this matters

Neither the Fastify server nor the Nginx reverse proxy sets security response headers. The web interface can be embedded in third-party iframes for clickjacking attacks. Browsers may MIME-sniff responses, and there is no Content Security Policy restricting frame ancestors. These are standard hardening headers with zero compatibility risk.

## Current state

Relevant files:
- `web/nginx.conf` — Nginx configuration serving the frontend and proxying `/api/`
- `server/src/index.js` — Fastify server entry point with `onSend` hook

**`server/src/index.js:81-83`** (only sets app version header):
```javascript
  fastify.addHook("onSend", async (request, reply) => {
    reply.header("X-App-Version", appVersion);
  });
```

**`web/nginx.conf:8-11`** (no security headers in server block):
```nginx
server {
    listen 127.0.0.1:8030;
    server_name _;
    client_max_body_size 100M;
```

**Repo conventions**: Headers are set via Fastify's `onSend` hook and Nginx `add_header` directives. The app runs behind Apache as the public entry point (per `nginx.conf:9` comment).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| All tests | `npm run test` | exit 0, all pass |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `web/nginx.conf`
- `server/src/index.js`

**Out of scope** (do NOT touch):
- Apache configuration (upstream reverse proxy, not in this repo)
- Any route files
- Client-side code

## Git workflow

- Branch: `fix/035-security-headers`
- Commit style: `fix(server,web): add HTTP security headers for clickjacking and MIME sniffing protection`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add security headers to Nginx

In `web/nginx.conf`, add security headers inside the `server { }` block, after the `error_log` line (line 27) and before the `etag on;` line (line 29). Add:

```nginx
    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Content-Security-Policy "frame-ancestors 'none'" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

**Verify**: `grep -c 'X-Frame-Options' web/nginx.conf` → returns 1

### Step 2: Add security headers to Fastify onSend hook

In `server/src/index.js`, extend the existing `onSend` hook at line 81-83 to also set security headers. This covers the dev environment where Nginx is not present:

Change:
```javascript
  fastify.addHook("onSend", async (request, reply) => {
    reply.header("X-App-Version", appVersion);
  });
```

To:
```javascript
  fastify.addHook("onSend", async (request, reply) => {
    reply.header("X-App-Version", appVersion);
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-Content-Type-Options", "nosniff");
  });
```

Note: CSP `frame-ancestors` is intentionally only set in Nginx (not Fastify) because media streaming responses with CSP headers can interfere with `<video>` and `<audio>` element cross-origin embedding in some browsers. The Nginx headers cover the HTML pages; Fastify covers the API.

**Verify**: `grep 'X-Frame-Options' server/src/index.js` → shows the header in the onSend hook

### Step 3: Run tests

**Verify**: `npm run test` → exit 0
**Verify**: `npm run lint` → exit 0

## Test plan

No new test file needed. Security headers are infrastructure-level and verified by:
- `grep` commands confirming header presence
- Manual verification via browser DevTools or `curl -I` in staging

## Done criteria

- [ ] `npm run test` exits 0
- [ ] `npm run lint` exits 0
- [ ] `grep 'X-Frame-Options' web/nginx.conf` returns a match
- [ ] `grep 'X-Content-Type-Options' web/nginx.conf` returns a match
- [ ] `grep 'Content-Security-Policy' web/nginx.conf` returns a match
- [ ] `grep 'X-Frame-Options' server/src/index.js` returns a match
- [ ] No files outside the in-scope list are modified

## STOP conditions

Stop and report back if:
- The `onSend` hook at index.js:81-83 doesn't match the excerpt
- The nginx.conf server block structure has changed significantly
- The app uses a CSP that would conflict with `frame-ancestors 'none'`

## Maintenance notes

- If the app needs to be embedded in iframes (e.g. for a Kiosk mode), `X-Frame-Options` and `frame-ancestors` must be updated.
- Apache (the upstream proxy) may also set these headers — if so, verify they don't conflict or duplicate.

## Implementation

Completed on 2026-10-04. Nginx now emits clickjacking, MIME-sniffing,
frame-ancestor, and referrer-policy headers. Fastify's global `onSend` hook also
emits `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` for direct
API and development responses.
