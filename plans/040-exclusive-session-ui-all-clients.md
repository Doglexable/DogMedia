# Plan 040: Show the exclusive session holder consistently on web, desktop, and mobile

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 9869988..HEAD -- web/src/api.js web/src/components/GlobalPlayer.jsx web/src/api.test.js desktop/src/api/client.rs desktop/src/domain/playback.rs desktop/src/ui/mod.rs desktop/src/ui/views/player_bar.rs desktop/src/ui/views/full_player.rs desktop/src/ui/views/video_mini_player.rs desktop/tests/api_contract.rs mobile/src/api.js mobile/src/api.test.js mobile/src/context/player-context.jsx mobile/src/components/full-player.jsx`
> This plan depends on Plan 039. Stop if the server does not expose the exact
> safe `activeSession` contract specified there.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: Plan 039 (no functional dependency on Plan 042 local
  folder fallback — local mode bypasses sessions so holder UI does not apply
  there; but both plans modify `desktop/src/ui/mod.rs`, so serialize execution
  and re-run the drift check if 042 lands first)
- **Category**: bug
- **Planned at**: commit `9869988`, 2026-10-05

## Why this matters

All three clients already participate in exclusive audio/video playback, but
they reduce conflicts to generic strings such as “another device.” A user
cannot tell whether Web, Desktop, or Mobile currently owns playback. This plan
preserves the typed holder descriptor from the server and presents one
consistent conflict state without exposing protected identifiers.

## Current state

### Web

- `web/src/api.js:36-48` preserves only `code` and `retryAfter` on errors.
- `web/src/components/GlobalPlayer.jsx:216-226` stores only
  `playbackAccessError`, a string.
- `web/src/components/GlobalPlayer.jsx:1722-1735` renders the string in a
  floating alert.

### Desktop

- `desktop/src/api/client.rs:25-28` represents playback conflicts with only
  `retry_after`.
- `desktop/src/api/client.rs:263-270` discards every other response field.
- `desktop/src/ui/views/player_bar.rs:121-123` shows “Play here” whenever a
  session is unavailable, but `DELETE /api/playback/lease/admin` is tier-100
  only. Desktop currently does not retain the access tier returned by
  `check_access()`.

### Mobile

- `mobile/src/api.js:41-63` creates protected sources and `readJson` attaches
  response data to `error.data`, but player state retains only the message.
- `mobile/src/context/player-context.jsx:321-329` handles audio conflicts.
- `mobile/src/components/full-player.jsx:495-505` handles video conflicts.
- Both render generic error text and neither offers holder details.

### Required presentation

Use equivalent content on each client:

- heading: `Playback is active elsewhere`;
- primary detail: `Dogmedia Desktop is playing this library` (using
  `deviceLabel`);
- optional media detail if the holder media can be resolved cheaply;
- countdown: `Available in about 24s` from `expiresIn`/`retryAfter`;
- no raw viewer ID, session ID, IP, or Redis information.

Use existing components and design tokens. Do not add a second playback owner
or a second queue implementation.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Web focused tests | `cd web && npm test -- --run src/api.test.js src/components/global-player/exclusive-session.test.jsx` | all selected tests pass |
| Web lint/build | `npm run lint --workspace=web && npm run build --workspace=web` | exit 0 |
| Desktop tests | `cargo test --manifest-path desktop/Cargo.toml` | all pass |
| Desktop clippy | `cargo clippy --manifest-path desktop/Cargo.toml --all-targets -- -D warnings` | exit 0 |
| Desktop release | `npm run build:desktop` | release binary produced |
| Mobile focused tests | `cd mobile && npm test -- --run src/api.test.js src/utils/exclusive-session.test.js` | all selected tests pass |
| Mobile lint | `npm run lint --workspace=mobile` | exit 0 |

## Scope

**In scope**:

- `web/src/api.js`
- `web/src/api.test.js`
- `web/src/components/GlobalPlayer.jsx`
- `web/src/components/global-player/exclusive-session.*` (new focused UI/helper files)
- `web/src/theme.css` only for conflict-card styling
- `desktop/src/api/client.rs`
- `desktop/src/domain/playback.rs`
- `desktop/src/ui/mod.rs`
- `desktop/src/ui/views/player_bar.rs`
- `desktop/src/ui/views/full_player.rs`
- `desktop/src/ui/views/video_mini_player.rs`
- `desktop/tests/api_contract.rs`
- `desktop/assets/native.css` only for conflict-card styling
- `mobile/src/api.js`
- `mobile/src/api.test.js`
- `mobile/src/context/player-context.jsx`
- `mobile/src/components/full-player.jsx`
- `mobile/src/utils/exclusive-session.js` and test (new)

**Out of scope**:

- Server response changes beyond Plan 039.
- Changing lease duration or heartbeat cadence.
- Automatic takeover without an explicit user action.
- Adding takeover to Web or Mobile in this plan.
- Displaying IP, viewer ID, or session ID.
- Rewriting GlobalPlayer, mobile player context, or desktop coordinator.

## Git workflow

- Branch: `feat/040-exclusive-session-holder-ui`
- Commit: `feat(playback): show exclusive session holder on every client`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define one normalized client-side holder shape

Use this semantic model in all clients:

```text
platform: web | desktop | mobile | unknown
deviceLabel: display-safe string
mediaId: optional positive integer
expiresIn: optional non-negative integer seconds
```

Each client must defensively normalize malformed/missing fields and fall back
to `Another device`. Keep the original error code and retry information.

**Verify**: focused pure tests in each language cover complete, partial,
unknown-platform, and malformed payloads.

### Step 2: Preserve and display the holder on Web

In `web/src/api.js`, attach normalized `activeSession` to errors from both
session creation and heartbeat. Send explicit headers when creating a session:
`X-Client-Platform: web` and `X-Client-Name: Dogmedia Web`.

In `GlobalPlayer.jsx`, replace the string-only state with a structured conflict
state while retaining a generic error path for unrelated failures. Extract a
small presentational component under `web/src/components/global-player/`.
Render it for initial `PLAYBACK_IN_USE` and later `PLAYBACK_LEASE_LOST`.

The countdown may be static text based on the received duration; do not add a
one-second root-level timer. If a live countdown is desired, isolate it inside
the conflict component as Plan 007 did for Now Playing.

**Verify**: tests assert the label/platform/countdown and confirm sensitive IDs
are never rendered. Run focused tests, lint, and build.

### Step 3: Preserve and display the holder on Desktop

Add a Rust holder struct with `serde(rename_all = "camelCase")` and optional
fields. Extend `ApiError::PlaybackInUse` and `PlaybackLeaseLost` to retain it;
update `map_status`, user messages, and existing tests.

Store the current holder in the playback coordinator snapshot when session
creation or heartbeat fails. Reuse one Dioxus component in mini audio, mini
video, and full player views. Keep transport controls disabled while the lease
is unavailable.

Fix takeover authorization while touching this UI: persist the tier returned
by `check_access()` in `NativeApp`, and render `SessionTakeoverButton` only when
tier is at least 100. Standard clients see holder details and retry guidance,
not a button that can only return 403.

Send `X-Client-Name: Dogmedia Desktop` alongside the existing
`X-Client-Platform: desktop` request header.

**Verify**: API mapping tests cover holder parsing; coordinator tests cover
holder set/clear; UI/render tests cover admin-versus-standard takeover
visibility. Run Cargo test, Clippy, and release build.

### Step 4: Preserve and display the holder on Mobile

In `mobile/src/api.js`, send `X-Client-Platform: mobile` and
`X-Client-Name: Dogmedia Mobile`. Normalize `error.data.activeSession` into a
small helper under `mobile/src/utils/`.

In `player-context.jsx`, retain structured conflict state for audio session
creation and heartbeat loss. In `full-player.jsx`, do the same for video. Use a
shared small React Native presentation component or shared formatting helper so
audio and video wording cannot drift.

Do not add takeover yet. The UI must clearly state who holds the lease and when
it is expected to expire.

**Verify**: API and helper tests cover initial conflict and heartbeat-loss
payloads; component-level assertions cover audio and video presentation where
the existing test harness permits. Run mobile focused tests and lint.

### Step 5: Run cross-client acceptance

Use three distinct clients with persisted viewer IDs:

1. Start playback on Web.
2. Attempt playback on Desktop and Mobile; both must identify Dogmedia Web.
3. Stop Web and start Desktop; Web/Mobile must identify Dogmedia Desktop.
4. Start Mobile; Web/Desktop must identify Dogmedia Mobile.
5. From tier-0/100-minus Desktop, verify no “Play here” button is offered.
6. From tier-100 Desktop, explicitly choose “Play here”; the previous client
   must pause after its next heartbeat and identify Dogmedia Desktop.
7. Confirm no log, UI, or response displays raw viewer/session identifiers.

## Test plan

- Web `api.test.js`: error retains safe holder fields.
- Web new conflict component test: full/fallback rendering and no sensitive data.
- Desktop `api_contract.rs`/client tests: serde mapping of safe holder.
- Desktop coordinator tests: holder cleared after successful replacement/stop.
- Desktop UI test: takeover only at tier >=100.
- Mobile `api.test.js`: request sends platform/name and error retains holder.
- Mobile helper test: safe display fallback and countdown formatting.
- Manual three-client matrix for actual Redis lease behavior.

## Done criteria

- [ ] Web, Desktop, and Mobile identify the current platform/device label.
- [ ] Initial conflicts and heartbeat lease loss use the same UI.
- [ ] Missing/malformed holder data falls back safely.
- [ ] No client displays viewer ID, session ID, or IP.
- [ ] Desktop “Play here” is visible only when access tier permits it.
- [ ] All focused tests, linters, web build, and desktop release build pass.
- [ ] Manual three-client acceptance matrix passes.

## STOP conditions

Stop and report if:

- Plan 039 is not complete or its response shape differs from this plan.
- Implementing the UI requires placing protected IDs in client state or logs.
- Desktop cannot retain access tier without changing the public server access contract.
- A client lacks a persisted viewer ID, causing every request to look like a new device.
- Full player and mini player would require separate playback-session requests.

## Maintenance notes

- The holder descriptor is display metadata, not authorization.
- Keep the three client fallback labels synchronized with the server allowlist.
- Future takeover support on Web/Mobile should be a separate plan with explicit
  authorization and confirmation UX.
- Reviewers should verify quality changes do not briefly show a false conflict
  for the same viewer and IP.

