# Plan 039: Make exclusive playback conflicts identify the active client safely

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9869988..HEAD -- server/src/playback-session.js server/src/playback-session.test.js server/src/routes/media.js server/src/routes/media.test.js server/src/routes/playback.js server/src/routes/playback.test.js server/src/index.js`
> Also run `git diff -- server/src/playback-session.js server/src/routes/media.js server/src/routes/playback.js`; this plan was written while the main working tree contained unrelated uncommitted work. If the excerpts below no longer describe the live code, stop and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (independent of Plan 042 local folder fallback —
  that plan is desktop-only with no server changes)
- **Category**: bug
- **Planned at**: commit `9869988`, 2026-10-05

## Why this matters

Dogmedia stores an exclusive audio/video lease in Redis, but a rejected client
only receives `PLAYBACK_IN_USE`, a generic message, and `retryAfter`. Web,
desktop, and mobile therefore cannot tell whether Web, Desktop, or Mobile owns
the lease. The acquisition script also treats IP address as ownership: a
different Dogmedia client on the same IP silently replaces the lease instead of
receiving a conflict. This plan makes the stable viewer identity part of the
ownership decision and exposes only a safe holder descriptor — never the
session ID or viewer ID.

## Current state

Relevant files:

- `server/src/playback-session.js` — Redis Lua scripts and exclusive lease model.
- `server/src/routes/media.js` — creates playback sessions and returns 409 conflicts.
- `server/src/routes/playback.js` — heartbeat, release, lease status, and admin release routes.
- Corresponding `*.test.js` files contain Fastify and in-memory Redis tests.
- `server/src/index.js` defines CORS request headers.

Current ownership check in `server/src/playback-session.js:17-28`:

```js
if currentRaw then
  local current = cjson.decode(currentRaw)
  if current.clientIp ~= ARGV[1] then
    return {0, redis.call('PTTL', KEYS[1])}
  end
  previousSessionId = current.sessionId or ''
end
```

This allows any new viewer on the same IP to replace the session. The stored
lease at `server/src/playback-session.js:192-200` already includes `viewerId`,
`sessionId`, `mediaId`, `clientIp`, and `platform`.

Current conflict response in `server/src/routes/media.js:1238-1244`:

```js
return reply.code(409).send({
  code: "PLAYBACK_IN_USE",
  error: "Media is currently playing on another device",
  retryAfter: lease.retryAfter,
});
```

Current `GET /api/playback/lease` response in
`server/src/routes/playback.js:707-715` withholds platform and media from a busy
standard client, even though both values are safe product metadata.

### Required public contract

Both `PLAYBACK_IN_USE` and `PLAYBACK_LEASE_LOST` responses must include:

```json
{
  "code": "PLAYBACK_IN_USE",
  "error": "Playback is active on Dogmedia Desktop",
  "retryAfter": 24,
  "activeSession": {
    "platform": "desktop",
    "deviceLabel": "Dogmedia Desktop",
    "mediaId": 42,
    "expiresIn": 24
  }
}
```

`platform` is restricted to `web | desktop | mobile`. `deviceLabel` is a
server-normalized display string of at most 64 Unicode characters and falls
back to `Dogmedia Web`, `Dogmedia Desktop`, or `Dogmedia Mobile`. The response
must never include `viewerId`, `sessionId`, raw Redis keys, or `clientIp`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused server tests | `cd server && npm test -- --run src/playback-session.test.js src/routes/media.test.js src/routes/playback.test.js` | all selected tests pass |
| Server lint | `npm run lint --workspace=server` | exit 0 |
| Full server tests | `npm run test:server` | exit 0, all pass |

## Scope

**In scope**:

- `server/src/playback-session.js`
- `server/src/playback-session.test.js`
- `server/src/routes/media.js`
- `server/src/routes/media.test.js`
- `server/src/routes/playback.js`
- `server/src/routes/playback.test.js`
- `server/src/index.js` only if `X-Client-Name` must be added to CORS headers

**Out of scope**:

- Client UI changes — Plan 040 consumes this contract.
- Changing the 30-second lease duration.
- Exposing viewer/session IDs or IP addresses.
- Replacing IP-based access authorization; this plan changes playback lease
  ownership only, not the whitelist architecture.
- Changing admin authorization for `DELETE /api/playback/lease/admin`.

## Git workflow

- Branch: `fix/039-exclusive-playback-holder-contract`
- Commit: `fix(playback): identify exclusive session holder safely`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Make viewer plus IP the lease owner

Change `ACQUIRE_LEASE_SCRIPT` so replacement succeeds only when both the stored
`viewerId` and `clientIp` equal the incoming values. A different viewer on the
same IP must receive a conflict. A different IP using the same viewer must also
receive a conflict because playback sessions and stream validation remain bound
to IP.

Pass both values as Lua arguments. On conflict, return the current lease JSON
from the same atomic script invocation along with its TTL. Do not perform a
separate `GET` after the failed acquisition; that introduces a race where the
reported holder may differ from the holder that caused the rejection.

Keep legitimate quality/session rotation working for the same viewer and IP:
return the previous session ID on successful replacement so the route can
revoke it as it does today.

**Verify**: add tests to `server/src/playback-session.test.js` proving:

1. same viewer + same IP can rotate session IDs;
2. different viewer + same IP is rejected and returns the original holder;
3. same viewer + different IP is rejected;
4. different viewer + different IP is rejected;
5. conflict metadata never contains a newly attempted lease as the holder.

Run the focused server test command; all pass.

### Step 2: Normalize safe client identity metadata

Add a small pure helper near `normalizeClientPlatform` in
`server/src/routes/media.js` (or a shared playback-session helper if tests make
that cleaner) that:

- accepts `X-Client-Name` only as a string;
- trims it, removes control characters, collapses whitespace, and caps it at 64
  Unicode characters;
- falls back to the platform label when absent/empty;
- never derives a label from `viewerId`, `sessionId`, cookies, or IP address.

Store this normalized `deviceLabel` in the lease. Add `X-Client-Name` to the
CORS allowed header list in `server/src/index.js` if browser clients will send
it.

**Verify**: unit tests cover absent, whitespace-only, overlong, and
control-character labels plus all three platform fallbacks.

### Step 3: Return the holder descriptor on acquisition and heartbeat conflicts

Create one serializer such as `publicLeaseHolder(lease, expiresIn)` that returns
only `platform`, `deviceLabel`, `mediaId`, and `expiresIn`. Reuse it for:

- `POST /api/media/:id/playback-session` → `PLAYBACK_IN_USE`;
- `POST /api/playback/lease/heartbeat` → `PLAYBACK_LEASE_LOST`;
- `GET /api/playback/lease` when state is `owned` or `busy`.

Update `REFRESH_LEASE_SCRIPT` just like acquisition: on mismatch, return the
current lease JSON atomically with its TTL so a displaced client learns the
actual new holder. If the key is absent, return no `activeSession` rather than a
fabricated holder.

Construct the human-readable `error` from the sanitized label, but clients must
use the structured `activeSession` field for UI.

**Verify**: Fastify route tests assert the exact safe shape for initial
conflict, heartbeat loss, busy status, and available status. Add negative
assertions for `viewerId`, `sessionId`, and `clientIp`.

### Step 4: Run full server gates

Run focused tests, full server tests, and server lint.

## Test plan

- Extend `server/src/playback-session.test.js` using its existing `memoryRedis`
  pattern for atomic acquisition/refresh behavior.
- Extend `server/src/routes/media.test.js` with a 409 response contract test.
- Extend `server/src/routes/playback.test.js` for heartbeat-lost and lease-status
  holder responses.
- Include a same-IP/different-viewer regression test; this is the bug that
  previously let Web/Desktop/Mobile replace one another silently.
- Include sensitive-field absence assertions on every public holder response.

## Done criteria

- [ ] A different viewer cannot replace an exclusive lease merely by sharing its IP.
- [ ] Same viewer + same IP session rotation still succeeds.
- [ ] Conflict responses contain the safe `activeSession` descriptor.
- [ ] No conflict/status response contains viewer ID, session ID, or client IP.
- [ ] Heartbeat loss reports the current holder when one exists.
- [ ] Focused and full server tests pass.
- [ ] Server lint passes.
- [ ] Only in-scope files and `plans/README.md` are modified.

## STOP conditions

Stop and report if:

- Redis does not support returning the stored JSON string from the Lua result.
- Legitimate quality switching uses a new viewer ID rather than the persisted
  viewer ID; changing ownership rules would then break quality switching.
- Product requirements demand exposing raw IP/viewer/session identifiers.
- The implementation requires weakening IP whitelist authorization.
- Current route shapes have drifted from the excerpts above.

## Maintenance notes

- `viewerId` identifies a client installation/browser profile; it is sensitive
  protocol state, not display identity. Keep it server-side.
- Any new platform must update the platform allowlist and fallback label tests.
- Reviewers should scrutinize the Lua return indexes and JSON parsing because a
  mismatch could report the attempted client rather than the actual holder.

