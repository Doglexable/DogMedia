# Plan 077: Prevent a second web tab from replacing the active tab's playback

> **Executor instructions**: Follow each step and its verification gate. Update the plan row in `plans/README.md` when done. Stop on a condition below.
>
> **Drift check (run first)**: `git diff --stat d5c1d9e..HEAD -- server/src/index.js server/src/playback-session.js server/src/playback-session.test.js server/src/routes/media.js server/src/routes/media.test.js server/src/routes/playback.js server/src/routes/playback.test.js server/src/playback-socket.js server/src/playback-socket.test.js web/src/api.js web/src/api.test.js web/src/components/GlobalPlayer.jsx web/src/components/global-player/playback-client-id.js web/src/components/global-player/playback-client-id.test.js`. Compare the excerpts below with live code if anything changed.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d5c1d9e`, 2026-10-27

## Why this matters

Browser tabs share the `pfs_viewer` cookie. The Redis acquisition script treats the same viewer plus account-scoped `clientIp` as the same playback owner, so play in tab B can silently rotate and revoke tab A's session. Keep quality and track changes within one tab working while making each browser document a distinct lease owner.

## Current state

- `server/src/playback-session.js:48-57`: acquisition replaces a lease when `viewerId` and `clientIp` match, regardless of browser tab. `:160-181` stores the playback session; `:270-301` builds the lease.
- `server/src/routes/media.js:1359-1417`: session creation resolves the shared viewer cookie and sends a stream cookie. `:1471-1497` validates stream requests by session, viewer, account-scoped IP, quality, and lease.
- `server/src/routes/playback.js:578-597` issues socket tickets; `:746-759` computes HTTP `owned` using viewer and IP. `server/src/playback-socket.js:61-70` computes socket `owned` the same way.
- `server/src/index.js:51-58` configures CORS with an explicit `allowedHeaders` list. A new `X-Playback-Client-ID` request header must be added there for deployments where web and API have different origins.
- `web/src/api.js:69-90` requests socket tickets and playback sessions without a tab identifier; `:144-152` reads status. `web/src/components/GlobalPlayer.jsx:259-294` requests a new session on media/quality change.
- `server/src/playback-session.test.js:133-151` explicitly tests same-viewer session rotation; preserve that **within one client instance**. The prior Plan 039 safe-holder contract must remain: public responses contain no viewer/session/client IP identifiers.

```lua
-- server/src/playback-session.js:48-55
if current.viewerId ~= ARGV[1] or current.clientIp ~= ARGV[2] then
  return {0, currentRaw, redis.call('PTTL', KEYS[1])}
end
previousSessionId = current.sessionId or ''
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server focus | `npm exec --workspace=server vitest run src/playback-session.test.js src/routes/media.test.js src/routes/playback.test.js src/playback-socket.test.js` | exit 0 |
| Web focus | `npm exec --workspace=web vitest run src/api.test.js src/components/global-player/playback-client-id.test.js src/components/global-player/exclusive-session.test.jsx` | exit 0 |
| Full Node gates | `npm run lint && npm test && npm run build` | all exit 0 |

## Scope

**In scope:** the server and web files in the drift-check command, plus the status row in `plans/README.md`.

**Out of scope:** account login sessions, native viewer-ID storage, Redis lease TTL, admin force release, mobile/desktop UI, and public holder fields.

## Git workflow

- Branch: `advisor/077-isolate-web-playback-per-tab`.
- Commit style: `fix(playback): isolate web lease ownership per tab`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define a browser-document client ID

Create `web/src/components/global-player/playback-client-id.js` with one opaque random ID per browser document, generated using `crypto.randomUUID()` or `crypto.getRandomValues()` and retained in module memory. Support ordinary HTTP LAN origins where `crypto.randomUUID()` may be unavailable. Do not use a shared cookie, localStorage, or URL. Send `X-Playback-Client-ID` from `requestPlaybackSocketTicket`, `createPlaybackSession`, and `getPlaybackLease` in `web/src/api.js`. Add the new header to the explicit CORS `allowedHeaders` in `server/src/index.js`. Keep the ID stable across component remounts in one document. Test stable same-document and fresh-document IDs; never log or expose the value in UI.

**Verify**: web focus command above → ID and request-header tests pass.

### Step 2: Make the Redis owner tuple client-aware

Add a validated `readPlaybackClientId(request, viewerId)` helper in `server/src/playback-session.js`. For a valid header, use that ID; for legacy/native requests without the header, fall back to `viewerId`. Reject malformed supplied values with HTTP 400 at the affected boundaries. Store the ID in the protected playback session, Redis lease, and socket ticket identity. Change Lua acquisition to replace only when viewer, account-scoped IP, **and client ID** match. A legacy lease without the field is interpreted as `clientId = viewerId` until it expires. Keep refresh/release guarded by exact `sessionId`, viewer, and IP, so HTML media requests do not need custom headers. Preserve atomic acquisition and previous-session revocation.

**Verify**: server focus command above → same-client rotation passes and a different client ID returns `PLAYBACK_IN_USE` without revoking the owner.

### Step 3: Align observer state with the new owner tuple

Use the client ID in `GET /api/playback/lease` and `playback-socket.js` `stateFor`. Tab A must receive `owned`; tab B using the same viewer cookie and IP must receive `busy` and the safe holder descriptor. A forced admin takeover still follows the existing route. Test HTTP and socket states, including an old lease without `clientId` and absence of private IDs from public JSON.

**Verify**: `npm run lint && npm test && npm run build` → all exit 0.

## Test plan

Extend the existing Fastify injection and socket tests cited above. Cover: tab A owns; tab B conflicts; tab A changes media/quality and rotates; tab B observes; tab A releases and tab B can then play; native/legacy callers without the new header retain current behavior. Use `web/src/api.test.js` for every new header. Keep stream cookie validation intact because HTML media elements cannot attach arbitrary headers.

## Done criteria

- [ ] Same-account, same-browser tab B cannot replace tab A by ordinary play.
- [ ] Track and quality changes in tab A still rotate sessions without a false conflict.
- [ ] HTTP and socket owner status agree; holder JSON contains no private identifiers.
- [ ] Stream and admin takeover behavior remain functional; all Node gates exit 0.
- [ ] CORS permits `X-Playback-Client-ID` for an allowed cross-origin web client.
- [ ] Only in-scope files change.

## STOP conditions

Stop if a header cannot be sent on both ticket and session creation, the existing session cookie/HTML stream path requires weakening server validation, or a native client must change to keep playing. Stop if an unrelated authentication change is needed. Report any reload edge case that cannot be contained to the lease TTL rather than adding persistent cross-tab storage ad hoc.

## Maintenance notes

A full reload creates a new document ID; the previous tab's lease should normally be released on teardown and otherwise expires at the configured TTL. Review both the HTTP and socket owner computations whenever lease ownership fields change.
