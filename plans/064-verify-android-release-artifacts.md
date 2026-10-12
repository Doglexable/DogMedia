# Plan 064: Verify Android release APKs before publishing

> **Executor instructions**: Follow this plan step by step. Do not weaken
> validation to preserve the current permissive behavior. If the trusted
> signing certificate or a reproducible verifier is unavailable, stop and
> report what is missing before changing deployment behavior.
>
> **Drift check (run first)**: `git diff --stat c26a4d4..HEAD -- server/src/routes/mobile-release.js server/src/routes/mobile-release.test.js server/Containerfile .env.example README.md`
> If an in-scope file changed after this plan was written, compare the current
> state below with the live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/062-expire-abandoned-mobile-release-uploads.md
- **Category**: security / correctness
- **Planned at**: commit `c26a4d4`, 2026-10-12
- **Execution status (2026-10-12)**: BLOCKED. The operator does not yet have a trusted release-signing certificate SHA-256 fingerprint. The local generated `mobile/android/app/build.gradle` also configures `release` with `signingConfigs.debug`; establish the intended production signing process before selecting its public fingerprint. Do not trust the debug certificate as the release allowlist merely to unblock this plan. No deployment behavior was changed.

## Why this matters

The Android release endpoint currently treats the four byte ZIP header as
proof that an upload is an APK, then replaces the published release. Any ZIP
file can pass that check, and no signer identity is checked. A malformed file
can replace a working download; a valid but untrusted package can be
distributed as the official app. Require an actual APK verification result and
compare the signing certificate against an operator configured allowlist
before replacing the published package.

## Current state

- `server/src/routes/mobile-release.js` assembles the upload in
  `POST /uploads/:uploadId/complete`, checks file size, reads four bytes, and
  renames the staging file over `dogmedia-android.apk`.
- `server/src/routes/mobile-release.test.js` currently uses a six byte
  ZIP-header fixture as a successful APK. Replace this fixture with a valid
  signed APK fixture or inject a verifier in route tests.
- `server/Containerfile` uses a Node 22 Alpine runtime and currently installs
  ffmpeg and fonts, not Android SDK Build Tools.
- `.env.example` documents server runtime settings but has no trusted Android
  signer fingerprint.
- `.env.example` and repository docs must never contain a real signing key or
  certificate private material. Only public certificate fingerprints belong
  in configuration.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm run test:server -- mobile-release.test.js` | release validation tests pass |
| Full server suite | `npm run test:server` | all server tests pass |
| Container build | `podman compose build server` | server image includes a working verifier |
| Lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:

- `server/src/routes/mobile-release.js`
- `server/src/routes/mobile-release.test.js`
- `server/Containerfile` or a small verifier adapter module under
  `server/src/`
- `.env.example` and the relevant Android release section of `README.md`
- `plans/README.md` (status only)

**Out of scope**:

- Android app source, release signing process, or private signing keys.
- Desktop release validation or the desktop download route.
- Changes to who can upload releases or who can download them.
- Publishing or replacing the production APK during implementation.

## Git workflow

- Branch: `advisor/064-verify-android-release-artifacts`
- Commit style: `fix(server): verify Android release APK before publish`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Establish the trusted signer configuration

Define `MOBILE_RELEASE_TRUSTED_CERT_SHA256` as a comma-separated allowlist of
SHA-256 fingerprints for public signing certificates. Normalize whitespace and
hex separators, reject malformed entries, and require at least one configured
fingerprint when completing a release upload; return a configuration error if
it is absent. Keep release listing and downloads available when it is absent.
Document the value as public certificate metadata, never a private key. Do not
choose a fingerprint from an uploaded artifact automatically.

**Verify**: add focused unit tests for empty, malformed, and multiple valid
fingerprints → malformed input fails closed and valid values normalize to
stable lowercase hex.

### Step 2: Verify APK structure and signature before publish

Add a small verifier adapter that runs a pinned, reproducible Android APK
verification tool available in the server runtime. Prefer Android SDK
Build Tools `apksigner verify --print-certs <assembled-apk>`: require exit 0,
parse the reported signer certificate SHA-256 digest, and compare it with the
configured allowlist. Require a match before `rename()` replaces the current
release. A verifier failure, invalid archive, unsigned APK, untrusted signer,
missing configuration, or tool execution error must return an error without
touching the currently published APK or metadata. Ensure the temporary
assembled file is removed on rejection.

Test the route through an injected verifier result so tests do not require an
Android SDK download. Keep at least one offline fixture for an invalid ZIP or
unsigned package.

**Verify**: `npm run test:server -- mobile-release.test.js` → valid trusted
signer publishes; invalid package, verifier failure, and untrusted signer do
not replace the existing APK or metadata.

### Step 3: Package and document the verifier

Update `server/Containerfile` to install or copy the exact verifier needed by
the adapter in the final runtime image. Pin its source/version or package
version. Document `MOBILE_RELEASE_TRUSTED_CERT_SHA256` in `.env.example` and
the release setup documentation, including how an operator obtains the public
certificate fingerprint from their established Android signing process. The
Compose server already loads `.env` through `env_file`; preserve that wiring.
Do not add credentials or private signing material to the image.

**Verify**: `podman compose build server` → image builds; execute the verifier
version/help command inside the built image → tool is present and reports the
expected pinned version.

### Step 4: Run server checks

Run focused tests, the full server test suite, and lint.

**Verify**: `npm run test:server && npm run lint --workspace=server` → exit 0.

## Test plan

- Valid APK with an allowlisted signer publishes and remains downloadable.
- Invalid archive, unsigned APK, verifier error, and non-allowlisted signer are
  rejected.
- Rejection preserves the previously published APK and metadata byte for byte.
- Missing or malformed trusted-certificate configuration fails closed.
- Model route tests after `server/src/routes/mobile-release.test.js` and keep
  verifier parsing/config tests isolated from filesystem route tests.

## Done criteria

- [ ] A ZIP header alone can no longer publish a release.
- [ ] The verifier checks APK signature and reports the signer fingerprint.
- [ ] Only configured signer fingerprints can replace the current APK.
- [ ] Rejected releases leave current APK and release metadata unchanged.
- [ ] The runtime image contains the pinned verifier.
- [ ] Focused/full server tests and lint pass.
- [ ] No private key or signing secret is committed or copied into the image.
- [ ] The Plan 064 status row in `plans/README.md` is updated.

## STOP conditions

- Stop if the operator's trusted signer fingerprint is not available; do not
  infer it from the candidate APK.
- Stop if `apksigner` or an equivalent verifier cannot be installed
  reproducibly in the Alpine runtime; report the viable runtime/tool options
  rather than silently
  allowing unverified uploads.
- Stop if atomic replacement cannot preserve the current APK and metadata on
  any verification or filesystem failure.

## Maintenance notes

Certificate rotation requires adding the new public fingerprint before
publishing with the new key, then removing the old fingerprint after rollout.
Review the signer comparison and failure ordering carefully; validation must
complete before the current release path is replaced.
