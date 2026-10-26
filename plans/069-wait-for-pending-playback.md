# Plan 069: Wait for a playable stream after an encoding-pending response

> **Executor instructions**: Follow every step and gate. Update only this plan's status row in `plans/README.md` when done. Stop on the conditions below.
>
> **Drift check first**: `git diff --stat d436e4f..HEAD -- web/src/api.js web/src/api.test.js mobile/src/api.js mobile/src/api.test.js desktop/src/api/client.rs desktop/tests/api_contract.rs`. Compare changed files to the excerpts below and stop on a mismatch.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW; three clients share an explicit server contract, but all need tests.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d436e4f`, 2026-10-26

## Why this matters

The server returns HTTP 202 with `ENCODING_QUEUED` and a `statusUrl` while a requested rendition is being encoded. The web and mobile readiness probes use `response.ok`, and the desktop probe accepts all 2xx statuses, so all three can mark that JSON response as a playable media stream. The player then starts early and the retry loop never runs.

## Current state

- `server/src/routes/media.js:1534-1543` returns `reply.code(202).send({ code: "ENCODING_QUEUED", statusUrl, retryAfter: 5 })` for a pending protected stream. It can also return 409 `ENCODING_NOT_READY` at `:1522-1532`.
- `web/src/api.js:92-114`, inside `preparePlaybackStream`, currently has:
  ```js
  if (response.ok) {
    await response.body?.cancel?.();
    return session.streamUrl;
  }
  const data = await response.json().catch(() => null);
  if (![202, 409].includes(response.status) || !data?.statusUrl) { /* error */ }
  ```
- `mobile/src/api.js:128-144`, inside `preparePlaybackSource`, has `if (response.ok) return source;` before its 202/409 branch.
- `desktop/src/api/client.rs:202-265`, inside `wait_for_stream_ready`, has `if (200..300).contains(&response.status) { return Ok(()); }` before parsing `Pending` and handling 202/409.
- `web/src/api.test.js` and `mobile/src/api.test.js` use Vitest mocked fetch/Response; `desktop/tests/api_contract.rs:16-49` defines `FakeTransport` with scripted `RawResponse` objects. Match these patterns.
- JS modules use ESM; Rust code uses `cargo fmt`. Do not change the server wire contract.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Web API tests | `npm run test:web -- --run src/api.test.js` | exit 0 |
| Mobile API tests | `npm run test:mobile -- --run src/api.test.js` | exit 0 |
| Desktop API tests | `cargo test --manifest-path desktop/Cargo.toml --test api_contract --locked` | exit 0 |
| JS lint | `npm run lint` | exit 0 |
| Rust format | `cargo fmt --manifest-path desktop/Cargo.toml -- --check` | exit 0 |
| JS suite | `npm run test` | exit 0 |

## Scope

**In scope**: `web/src/api.js`, `web/src/api.test.js`, `mobile/src/api.js`, `mobile/src/api.test.js`, `desktop/src/api/client.rs`, `desktop/tests/api_contract.rs`, this plan's row in `plans/README.md`.

**Out of scope**: `server/src/routes/media.js`, playback lease rules, UI/player components, encoding worker, server response schema, and unrelated HTTP helpers.

## Git workflow

Use `advisor/069-wait-for-pending-playback` and a conventional commit such as `fix(playback): wait for pending rendition across clients`. Do not push or open a PR without operator instruction.

## Steps

### Step 1: Add a pending-then-ready case in each client

In each test file, script a first probe response of 202 with `{ code: "ENCODING_QUEUED", statusUrl: "/api/media/9/encoding/status", retryAfter: 0 }`, followed by a successful stream probe (206 with one byte is the normal Range response). Assert the method performs two probes before returning. In JS use fake timers or a resolved timer so the minimum 250 ms retry delay does not slow the suite. In Rust use `FakeTransport`; `retryAfter: 0` avoids a real sleep. Also test a malformed 202 without `statusUrl` fails rather than being accepted, and that a 200/206 stream remains immediately accepted.

**Verify**: the three focused test commands above → the new pending cases fail against the old code for early success.

### Step 2: Recognize readiness by stream status, not a generic 2xx check

Update the three readiness methods so 202 flows into the existing pending branch. Accept only the successful stream statuses the server uses (200 for full stream and 206 for byte Range). Keep 409 pending handling, timeout bounds, retry timing, and error fields intact. For web, cancel the response body only on a ready stream; for mobile, preserve its returned source and headers. Do not poll `statusUrl` unless evidence shows the stream probe cannot provide readiness—the existing loop already retries the stream.

**Verify**: `npm run test:web -- --run src/api.test.js && npm run test:mobile -- --run src/api.test.js && cargo test --manifest-path desktop/Cargo.toml --test api_contract --locked` → exit 0; each pending case uses two probes.

### Step 3: Run workspace gates

Run JavaScript lint/tests and Rust format. Review the status predicates in all three client files once more to confirm 202 is excluded from success.

**Verify**: `npm run lint && npm run test && cargo fmt --manifest-path desktop/Cargo.toml -- --check` → exit 0.

## Test plan

Use the existing API test mocks in `web/src/api.test.js` and `mobile/src/api.test.js`; use `FakeTransport` in `desktop/tests/api_contract.rs`. The behavioral assertion is the probe count/order, not merely a predicate string. Cover 202 then 206, malformed 202, 409 with `statusUrl`, and immediate 200/206. The server's 202 contract is already present; server tests need no change.

## Done criteria

- [ ] All three focused client tests, full JS lint/tests, and Rust format gate exit 0.
- [ ] 202 never returns a playable URL/source or `Ok(())` until a later 200/206 probe.
- [ ] No source file outside Scope changes; only this plan's index row may also change.

## STOP conditions

- The server changes its pending or range response status contract from 202/409 and 200/206.
- Implementing this requires changing player UI or the encoding worker.
- A drift excerpt mismatches or a gate fails twice.

## Maintenance notes

Readiness probes must distinguish a successful HTTP request from a playable media response. If another server pending status is introduced, update these three implementations and their contract tests together.
