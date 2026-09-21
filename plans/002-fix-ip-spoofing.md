# Plan 002: Eliminate Client IP Spoofing on Loopback Proxy Hops

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

DogMedia uses IP-based authorization without passwords. In `server/src/plugins/auth.js:51-63`, `getClientIp` checks if the immediate socket peer is a loopback address (`127.0.0.1` or `::1`). Since Nginx runs on the host or in network host mode, all proxied requests come from loopback. In this case, `getClientIp` calls `getFirstValidHeaderIp` on `request.headers["x-forwarded-for"]`, which picks the **first (leftmost)** IP in the list.

If a remote client supplies a forged header such as `X-Forwarded-For: 127.0.0.1`, Nginx (via `$client_forwarded_for` in `web/nginx.conf:12-15`) forwards the client's header directly to Fastify. Fastify reads `127.0.0.1` as `clientIp` and immediately grants tier 999 (full Administrator) access!

Fixing this ensures Fastify and Nginx only trust validated proxy hops and prevents client-forged IP headers from spoofing admin or whitelisted tiers.

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
- Database `ip_whitelist` table structure.
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
- Furthermore, ensure `normalizeIp` is applied to all IP return values (including direct `request.ip`), stripping any `::ffff:` prefix so dual-stack IPv4-mapped IPv6 addresses match PostgreSQL CIDRs.

### Step 3: Add Verification Tests

In `server/src/plugins/auth.test.js` (or `server/src/routes/playback.test.js`):
- Test that a request with `x-forwarded-for: 127.0.0.1, 203.0.113.195` from loopback socket correctly resolves to `203.0.113.195`, preventing the client from spoofing loopback admin access.
- Test that IPv4-mapped `::ffff:192.168.1.5` correctly normalizes to `192.168.1.5`.

## Done criteria

- [ ] `npm run lint --workspace=server` exits 0.
- [ ] `npm run test:server` exits 0 with all IP resolution tests passing.
- [ ] Forged `X-Forwarded-For: 127.0.0.1` does not grant tier 999.

## STOP conditions

- If external proxy infrastructure requires chaining through multiple trusted upstream proxies with custom CIDR trust, stop and report.
