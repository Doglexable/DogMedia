# Plan 002: Eliminate Client IP Spoofing on Loopback Proxy Hops

> **Account migration note (2026-10-26):** This is a completed historical
> proxy-hardening plan. Source IP no longer authorizes users or grants tier 999.
> `server/src/plugins/auth.js` authenticates username/password accounts through
> Redis-backed sessions, sets `request.user.id` and `request.accessTier`, and
> uses `request.networkIp` for network controls such as login rate limits.
> The `clientIp` field on protected requests is a synthetic account key.

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- server/src/plugins/auth.js server/src/plugins/auth.test.js web/nginx.conf`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

At the time this plan was written, the server used IP authorization. Its old `getClientIp` read the first, client-controlled forwarded address from a loopback proxy hop. The excerpt below records that historical implementation.

The spoofed-header risk originally included an administrator-tier bypass. Under the current account flow, forwarded headers must still be handled correctly for `request.networkIp`, registration/login rate limits, and logs, but cannot grant account access or privilege.

This completed work hardened proxy-hop handling. Any future change must preserve account-session and tier authorization regardless of source IP.

## Current state

- `server/src/plugins/auth.js:36-63`:
```javascript
function getFirstValidHeaderIp(value) {
  const headers = Array.isArray(value) ? value : [value];

  for (const header of headers) {
    if (typeof header !== "string") continue;

    for (const rawIp of header.split(",")) {
      const ip = normalizeIp(rawIp);
      if (isIP(ip)) return ip;
    }
  }

  return null;
}

export function getClientIp(request) {
  const proxyPeerIp = request.raw?.socket?.remoteAddress || request.socket?.remoteAddress;

  if (isLoopbackIp(proxyPeerIp || request.ip)) {
    return (
      getFirstValidHeaderIp(request.headers["x-forwarded-for"]) ||
      getFirstValidHeaderIp(request.headers["x-real-ip"]) ||
      request.ip
    );
  }

  return request.ip;
}
```
- `web/nginx.conf:12-15`:
```nginx
map $http_x_forwarded_for $client_forwarded_for {
    default $http_x_forwarded_for;
    "" $client_real_ip;
}
```

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `npm run test:server`    | exit 0, all pass    |
| Lint      | `npm run lint`           | exit 0              |

## Scope

**In scope**:
- `server/src/plugins/auth.js`
- `web/nginx.conf`
- `server/src/plugins/auth.test.js` (create or update)

**Out of scope**:
- Account database and session authorization.
- Client routing.

## Git workflow

- Branch: `advisor/002-fix-ip-spoofing`
- Commit message: `fix(auth): secure client IP resolution against header spoofing`

## Steps

### Step 1: Secure Nginx Forwarding Configuration

In `web/nginx.conf`:
- When proxying to `/api/`, ensure that Nginx does not allow untrusted incoming client `X-Forwarded-For` or `X-Real-IP` to dictate `$client_real_ip` unless received from a trusted proxy (`set_real_ip_from`).
- Set `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (or `$remote_addr` if direct client) instead of passing raw `$client_forwarded_for`.
- Set `proxy_set_header X-Real-IP $remote_addr;`.

### Step 2: Use Safe IP Resolution in Fastify Auth Plugin

In `server/src/plugins/auth.js`:
- In Fastify, `request.ip` uses `proxy-addr` based on `trustProxy` (configured in `server/src/index.js`).
- If inspecting `X-Forwarded-For` manually behind a single trusted reverse proxy (e.g. Nginx on loopback), the genuine client IP is the **last untrusted hop** (e.g. `rawIps[rawIps.length - 1]`), NOT the first entry which is client-supplied!
- Ensure `normalizeIp` is applied to all network IP return values, including direct `request.ip`, so rate limits and audit records use a consistent address.

### Step 3: Add Verification Tests

In `server/src/plugins/auth.test.js` (or `server/src/routes/playback.test.js`):
- Test that a request with `x-forwarded-for: 127.0.0.1, 203.0.113.195` from a trusted loopback proxy resolves `request.networkIp` to the correct client address without changing the authenticated account or its tier.
- Test that IPv4-mapped `::ffff:192.168.1.5` correctly normalizes to `192.168.1.5`.

## Done criteria

- [ ] `npm run lint --workspace=server` exits 0.
- [ ] `npm run test:server` exits 0 with all IP resolution tests passing.
- [ ] Forged `X-Forwarded-For: 127.0.0.1` cannot change the authenticated account, its tier, or the network rate-limit identity.

## STOP conditions

- If external proxy infrastructure requires chaining through multiple trusted upstream proxies with custom CIDR trust, stop and report.
