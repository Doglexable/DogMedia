# Plan 047: Reject silently-truncated direct uploads over the size cap

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/src/routes/media.js server/src/index.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `2bf8caa`, 2026-10-06

## Why this matters

The global multipart cap is 20MB, but the direct-upload route never detects
the over-limit condition: a film-length file is stored truncated yet reported
as a successful 201, then finalized and queued for encoding — corrupt media
presented as healthy while wasting pipeline work. After this plan, over-cap
direct uploads fail fast with 413 and never reach persistence.

## Current state

Relevant files:

- `server/src/index.js:58-62` — global multipart registration.
- `server/src/routes/media.js:745-800` — direct `POST /` part loop;
  `savePartToTemp(part)` helper and `cleanupUploads(...)` helper nearby.
- `server/src/routes/media.test.js` — upload route tests.

```js
// server/src/index.js:58-62
await app.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});
```

```js
// server/src/routes/media.js:755-759 — direct POST / loop, no truncation check
for await (const part of request.parts()) {
  if (part.type === "file") {
    if (part.fieldname === "file") {
      if (mainFileUpload) await unlink(mainFileUpload.tempPath).catch(() => {});
      mainFileUpload = await savePartToTemp(part);
```

Verified 2026-10-06: `grep -rn "truncated" server/src/` returns nothing; only
the chunked path (`media.js:898`) sets a per-chunk limit. The `@fastify/multipart`
part object exposes `part.truncated === true` when the fileSize limit is hit
(check the installed version's docs/README in `node_modules/@fastify/multipart`
to confirm the exact flag name before coding).

Repo conventions: early `reply.code(4xx).send({ error: "..." })` returns with
`cleanupUploads(...)` on upload failures; tests via inject harness.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Server tests | `npm run test:server` | all pass |
| Lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:

- `server/src/routes/media.js` (direct `POST /` path + `savePartToTemp` if the
  check belongs there)
- `server/src/routes/media.test.js` (extend)

**Out of scope**:

- Changing the 20MB value itself or adding a configurable limit — not this plan.
- Chunked `/uploads` flow changes (already has per-chunk limits).
- Client-side pre-validation in web/mobile — not this plan.
- The busboy upgrade (plan 048) — independent; either order works.

## Git workflow

- Branch: `advisor/047-direct-upload-truncation-guard`
- Conventional commits, e.g. `fix(server): reject truncated direct uploads with 413`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Confirm the truncation signal in the installed multipart version

Read `node_modules/@fastify/multipart/README.md` (or its `lib/` source) and
confirm the exact property signalling an over-limit file part
(expected: `part.truncated === true`). Also read `savePartToTemp` in
`media.js` to see where the part stream is consumed — the check must run
**after** the stream is fully consumed (truncation is only known at EOF).

**Verify**: you can cite the exact flag name + file/line in the dependency
before writing code. If no such flag exists in the installed version, STOP
and report (see STOP conditions).

### Step 2: Reject truncated parts with 413 before persisting

In the direct `POST /` handler (and thumbnail/lyrics parts for consistency):

- After `savePartToTemp(part)` (or inside it — pick the spot where all three
  call sites are covered), if the part was truncated: `await cleanupUploads(...)`
  all temp files collected so far and return
  `reply.code(413).send({ error: "File exceeds the 20MB direct-upload limit; use chunked upload" })`.
- Mention the chunked-upload route path in the error message (check the exact
  chunked route prefix in `media.js` — do not guess; read it).
- Ensure temp files are removed on this path (no orphaned files in the tmp dir).

**Verify**: `npm run test:server` → existing upload tests still pass.

### Step 3: Add regression tests

Extend `media.test.js` (or the upload-focused test file if one fits better):

- Direct `POST /` with a part larger than the limit (mock the part stream with
  `truncated: true`, or send an over-limit payload if the harness supports it —
  prefer the mock; sending real 20MB+ payloads in tests is wasteful) → 413,
  no `media_assets` row created, temp files cleaned.
- Normal small upload still returns 201 (already covered — keep green).

**Verify**: `npm run test:server` → all pass including new 413 test.

## Test plan

- New 413 regression test per step 3, modeled on existing upload tests.
- Full server suite green; lint clean.

## Done criteria

- [ ] `npm run test:server` exits 0 with new 413 test passing
- [ ] Direct `POST /` code path references the truncation flag and returns 413
      before any DB insert
- [ ] `npm run lint --workspace=server` exits 0
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The installed `@fastify/multipart` exposes no truncation signal (then the
  correct fix differs — report instead of inventing detection).
- Current-state excerpts don't match live code.
- Verification fails twice after reasonable attempts.
- Fix requires out-of-scope files.

## Maintenance notes

- If the 20MB cap is ever raised/configured, the 413 message text must be
  updated in lockstep — consider reading the limit from a shared constant.
- A future enhancement (out of scope): client-side file-size pre-check in
  web/mobile upload forms to fail even faster.
