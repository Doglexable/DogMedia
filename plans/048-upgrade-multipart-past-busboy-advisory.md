# Plan 048: Upgrade @fastify/multipart past the busboy CRLF-injection advisory

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/package.json package-lock.json server/src/routes/media.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `2bf8caa`, 2026-10-06

## Why this matters

The installed `@fastify/busboy@3.2.0` (via `@fastify/multipart@10.0.0`) is
flagged HIGH for CRLF injection via multipart Content-Disposition filename and
name — and `server/src/routes/media.js` accepts client-controlled filenames on
a network-reachable upload route. Upgrading to a fixed busboy removes a
response-splitting/header-injection class issue from the upload path.

## Current state

- `server/package.json:17`: `"@fastify/multipart": "^10.0.0"`, resolving to
  `@fastify/busboy@3.2.0` (verified via `npm ls` on 2026-10-06).
- Advisory affects `@fastify/busboy <= 3.2.1`.
- Consumers: direct `POST /` (`media.js:745+`) and chunked upload flow
  (`media.js:898` per-chunk limits). Plan 001 (DONE) sanitizes extensions;
  this plan fixes the parser itself.

Repo conventions: npm workspaces (`server`, `web`, `mobile`); root lockfile
`package-lock.json`. Upload route tests: `routes/media.test.js`,
`media-replacement.test.js`, `upload-completion-worker.test.js`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Audit (server) | `npm audit --omit=dev --workspace=server` | busboy advisory gone |
| Server tests | `npm run test:server` | all pass |
| Lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:

- `server/package.json` (version bump)
- `package-lock.json` (regenerated)
- `server/src/routes/media.js` — ONLY if the new multipart version changes an
  API you use (e.g. option names); keep any such adaptation minimal.

**Out of scope**:

- Any other dependency upgrades (Expo/Vite-chain advisories are dev-confined;
  deliberately deferred).
- Upload behavior changes, new validation, or refactoring — pure upgrade plus
  breakage adaptation only.
- Patching transitives by hand (`overrides`) unless the upgrade path does not
  exist (prefer the released fix).

## Git workflow

- Branch: `advisor/048-multipart-busboy-upgrade`
- Conventional commits, e.g. `fix(server): upgrade @fastify/multipart past busboy advisory`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Resolve the fixed version and upgrade

1. Run `npm view @fastify/multipart versions` and identify the first release
   requiring `@fastify/busboy > 3.2.1` (check its changelog if available).
2. Bump `server/package.json` to that release (keep the `^` range style).
3. Run `npm install --workspace=server` (or root `npm install`) to regenerate
   the lockfile. Verify with `npm ls @fastify/busboy` that the resolved
   version is `> 3.2.1`.

**Verify**: `npm audit --omit=dev --workspace=server` → the
`@fastify/busboy` CRLF-injection advisory is gone (other unrelated advisories
may remain; record them, do not chase them).

### Step 2: Adapt to any breaking multipart changes and run upload tests

1. Diff the multipart changelog between 10.0.0 and the new version for
   breaking changes (option names, part object shape, error codes).
2. If `media.js` uses a changed API, adapt minimally.
3. Run the upload-focused tests:
   `npx vitest run server/src/routes/media.test.js server/src/media-replacement.test.js server/src/upload-completion-worker.test.js`
   (adjust paths to actual filenames — list `server/src/*.test.js` first),
   then the full `npm run test:server`.

**Verify**: full `npm run test:server` exits 0.

## Test plan

- No new tests required (upgrade plan); the existing upload suites
  (`media.test.js`, `media-replacement`, `upload-completion-worker`) are the
  verification story. If the new version changes truncation/error behavior,
  extend the 413 test from plan 047 only if it already landed — otherwise note
  it and move on.

## Done criteria

- [ ] `npm ls @fastify/busboy` shows `> 3.2.1`
- [ ] `npm audit --omit=dev --workspace=server` no longer reports the busboy
      CRLF-injection advisory
- [ ] `npm run test:server` exits 0
- [ ] `npm run lint --workspace=server` exits 0
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- No released `@fastify/multipart` pins a fixed busboy (then evaluate `npm
  audit fix` or a scoped `overrides` entry — and report before doing it).
- The upgrade breaks upload tests in ways requiring behavioral rewrites
  (report; do not redesign the upload flow here).
- Current-state excerpts don't match (e.g. version already bumped — then verify
  and mark DONE).

## Maintenance notes

- Dependabot/Renovate-style vigilance: multipart parser advisories recur;
  re-run `npm audit` after each bump.
- If plan 047 (truncation guard) lands first, re-run its 413 test here — parser
  upgrades can change truncation-signalling behavior.
