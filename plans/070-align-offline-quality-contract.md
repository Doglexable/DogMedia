# Plan 070: Return offline metadata for the file the user can download

> **Executor instructions**: Follow each step and verification gate. Update only this plan's status row in `plans/README.md` when complete. Stop on the listed conditions.
>
> **Drift check first**: `git diff --stat d436e4f..HEAD -- server/src/routes/offline.js server/src/routes/offline.test.js`. Compare changed files with the excerpts below and stop on a mismatch.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW; changes only server selection of permitted offline metadata.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d436e4f`, 2026-10-26

## Why this matters

A standard user requesting original quality receives high-quality bytes from the download route, but the default manifest and validation paths describe the original file. Mobile compares downloaded byte size and file version with manifest metadata before saving. A mismatch makes a valid download fail verification; validation can also report the inaccessible original as valid.

## Current state

- `server/src/routes/offline.js:17` sets `ORIGINAL_QUALITY_MIN_TIER` (default 100). `:35-55` serializes the selected file's `byteSize`, `fileVersion`, and `quality`.
- Manifest at `:188-205` defaults to `ori` and passes that to `manifestItems`. The helper at `:131-160` selects the original directly for `ori` and may fall back to original if an encoded path is missing.
- Download at `:207-249` already maps `ori` to `high` for users below the original tier (`:215-218`), queues an absent high rendition with HTTP 202, and rejects fallback to original.
- Validate at `:251-299` groups request items by their stated/default quality. It does not apply the original-tier rule before computing current file version.
- `server/src/routes/offline.test.js:77-86` expects `quality=ori` to download high bytes for a tier 0 user; `:128-140` expects the default manifest's original size/version for the same tier. The fixture writes distinct original and high files at lines 14-20.
- `mobile/src/context/offline-context.jsx:243-249` rejects a download if its bytes or response version differ from manifest metadata. The mobile download methods pass an explicit quality preference at lines 320-329.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm run test:server -- --run src/routes/offline.test.js` | exit 0 |
| Server lint | `npm run lint --workspace=server` | exit 0 |
| Server suite | `npm run test:server` | exit 0 |

## Scope

**In scope**: `server/src/routes/offline.js`, `server/src/routes/offline.test.js`, this plan's row in `plans/README.md`.

**Out of scope**: `mobile/src/context/offline-context.jsx`, media playback quality policy, encoding worker, offline database schema, general download URL shape, and original-tier configuration.

## Git workflow

Use `advisor/070-align-offline-quality-contract` with a conventional commit such as `fix(server): align offline metadata with permitted quality`. Do not push or open a PR without operator instruction.

## Steps

### Step 1: Test all three offline endpoints as one contract

Extend `offline.test.js` using its existing fixture. For tier 0, request the default/`quality=ori` manifest and assert `quality: "high"`, high-file byte size/version, and a matching `quality=ori` download response. Send the manifest version to `/validate` with both omitted and `ori` quality and assert it is valid for the high file, while the original version is not valid. Test high rendition absent: manifest must return 202/`ENCODING_QUEUED`, not original metadata. Test tier 100 retains original behavior and an explicit high request returns high metadata.

**Verify**: `npm run test:server -- --run src/routes/offline.test.js` → new tier-0 manifest/validate cases fail for the intended mismatch against old code.

### Step 2: Share effective-quality selection

In `offline.js`, centralize the rule already used by download: when requested quality is `ori` and caller tier is below `ORIGINAL_QUALITY_MIN_TIER`, effective quality is `high`; otherwise use requested quality. Apply it in manifest before fetching variants, queuing, and calling `manifestItems`, and in validate before grouping versions. When an encoded file is missing, never serialize original metadata for a standard user; use the existing encoding-pending response for manifest, and return a non-valid validation status for stored items. Preserve response shapes and admin fallback behavior. Keep validation's output order aligned with request order.

**Verify**: `npm run test:server -- --run src/routes/offline.test.js` → all new contract cases pass.

### Step 3: Verify the server

Run lint and the full suite. Confirm the default manifest, explicit original manifest, download, and validation paths all use the same quality rule.

**Verify**: `npm run lint --workspace=server && npm run test:server` → exit 0.

## Test plan

Use `server/src/routes/offline.test.js` and its original/high fixture. Assert actual `byteSize`, `fileVersion`, and `quality`, not just status. Include a missing high variant, an unavailable encoded path, a tier 100 original request, and validation after tier downgrade. A standard user must never see a valid original version returned by validation.

## Done criteria

- [ ] Focused tests, lint, and full server tests exit 0.
- [ ] For tier 0, `ori` manifest metadata matches what `ori` download serves; high missing produces pending/not-valid rather than original metadata.
- [ ] Tier 100 original requests retain their current file and response shape.
- [ ] Only scoped files and this plan's index row change.

## STOP conditions

- The offline API intentionally promises original metadata while downloading an encoded file; report the contract conflict rather than changing the client silently.
- Correctness requires editing mobile storage format or changing the server's public response schema.
- Drift review mismatches or a gate fails twice.

## Maintenance notes

Any new quality tier or offline validation field must use the same effective-quality rule in manifest, download, and validate. Review fallback paths whenever variants can be queued or files disappear after database status becomes ready.
