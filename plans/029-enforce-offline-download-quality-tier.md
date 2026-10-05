# Plan 029: Enforce original quality tier restriction on offline download endpoint

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat edc7905..HEAD -- server/src/routes/offline.js server/src/routes/media.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `edc7905`, 2026-10-04
- **Implementation**: Completed on 2026-10-04. The download route falls back
  from an unauthorized original request to a ready high variant and refuses
  every path that would otherwise fall back to an original file.

## Why this matters

The main media streaming endpoint (`GET /api/media/:id/stream` at `server/src/routes/media.js:1206`) enforces `ORIGINAL_QUALITY_MIN_TIER` (tier >= 100) before serving original-quality audio/video files. The offline download endpoint (`GET /api/offline/media/:id/download`) defaults to `quality=ori` and serves original files without any tier check. This allows guest and standard network users (tier 0) to download unencoded master audio files, bypassing the quality restriction enforced everywhere else.

## Current state

Relevant files:
- `server/src/routes/offline.js` — offline download and sync routes
- `server/src/routes/media.js` — media streaming routes (contains the tier check to match)
- `server/src/media-quality.js` — quality normalization utilities

**`server/src/routes/offline.js:180-209`** (the download handler, no tier check):
```javascript
  fastify.get("/media/:id/download", async (request, reply) => {
    const requestedQuality = normalizeRequestedQuality(request.query?.quality, { defaultQuality: "ori" });
    if (!requestedQuality) return reply.code(400).send({ error: "quality must be low, med, high, or ori" });
    const mediaId = normalizeOfflineMediaId(request.params.id);
    if (!mediaId) return reply.code(400).send({ error: "Invalid media ID" });
    const rows = await accessibleAudioRows(fastify, request.accessTier, request.clientIp || request.ip, { mediaIds: [mediaId] });
    if (rows.length === 0) return sendMissingOrDenied(fastify, reply, mediaId);
    const media = rows[0];
    let selected = await resolveQualityFile(fastify.pg, media, requestedQuality);
    // ... serves file without checking tier for ori quality
  });
```

**`server/src/routes/media.js:1205-1208`** (the pattern to match — tier check for original quality):
```javascript
    const protectedMedia = media.mime_type?.startsWith("audio/") || media.mime_type?.startsWith("video/");
    if (protectedMedia && requestedQuality === "ori" && request.accessTier < ORIGINAL_QUALITY_MIN_TIER) {
      return reply.code(403).send({ error: "Original quality requires admin access" });
    }
```

`ORIGINAL_QUALITY_MIN_TIER` is defined as `100` in `server/src/routes/media.js:36`.

**Repo conventions**: Routes use Fastify plugin pattern. Error responses use `{ error: "message" }`. Access tier is available as `request.accessTier` (set by `server/src/plugins/auth.js`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Server tests | `npm run test:server` | exit 0, all pass |
| All tests | `npm run test` | exit 0, all pass |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `server/src/routes/offline.js`
- `server/src/routes/offline.test.js` (create if not exists, or add tests)

**Out of scope** (do NOT touch):
- `server/src/routes/media.js` — the quality check there is correct and complete
- `server/src/media-quality.js` — quality normalization is correct
- Any client code (web, mobile, desktop)

## Git workflow

- Branch: `fix/029-offline-download-quality-tier`
- Commit style: `fix(server): enforce quality tier restriction on offline download`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the tier constant and enforcement check

In `server/src/routes/offline.js`, add a constant at the top of the file (after the imports, near the existing constants on lines 13-14):

```javascript
const ORIGINAL_QUALITY_MIN_TIER = 100;
```

Then in the `GET /media/:id/download` handler (line ~187, after the `rows` check and `const media = rows[0];`), add the tier enforcement before the `resolveQualityFile` call:

```javascript
    if (requestedQuality === "ori" && request.accessTier < ORIGINAL_QUALITY_MIN_TIER) {
      // Fall back to highest available encoded quality instead of rejecting
      const fallbackQuality = "high";
      let selected = await resolveQualityFile(fastify.pg, media, fallbackQuality);
      // ... continue with the fallback quality
    }
```

The cleanest approach: after `const media = rows[0];`, add:
```javascript
    const effectiveQuality = (requestedQuality === "ori" && request.accessTier < ORIGINAL_QUALITY_MIN_TIER)
      ? "high"
      : requestedQuality;
    let selected = await resolveQualityFile(fastify.pg, media, effectiveQuality);
```

Replace the existing `let selected = await resolveQualityFile(fastify.pg, media, requestedQuality);` with the code above.

**Verify**: `grep -n 'ORIGINAL_QUALITY_MIN_TIER' server/src/routes/offline.js` → shows the constant and usage

### Step 2: Add test coverage

Check if `server/src/routes/offline.test.js` exists. If not, create it following the pattern in `server/src/routes/media.test.js`. Add tests that verify:

1. A request with `accessTier = 0` and `quality=ori` receives the `high` quality fallback (check `X-Media-Quality` header is not `ori`).
2. A request with `accessTier = 100` and `quality=ori` receives original quality normally.
3. A request with `accessTier = 0` and `quality=high` works normally (no change).

Use the existing test pattern from `server/src/offline.test.js` or `server/src/routes/media.test.js` — mock `fastify.pg.query` and use `fastify.inject()`.

**Verify**: `npm run test:server` → all tests pass including new ones

### Step 3: Final verification

**Verify**: `npm run test` → exit 0, all tests pass
**Verify**: `npm run lint` → exit 0

## Test plan

- New tests in `server/src/routes/offline.test.js` covering:
  - Guest tier (0) requesting `quality=ori` → falls back to `high`
  - Admin tier (100) requesting `quality=ori` → serves original
  - Any tier requesting `quality=high` → serves high as-is
- Model after `server/src/routes/media.test.js` for Fastify inject pattern.
- Verification: `npm run test:server` → all pass

## Done criteria

- [ ] `npm run test` exits 0
- [ ] `npm run lint` exits 0
- [ ] `grep -n 'ORIGINAL_QUALITY_MIN_TIER' server/src/routes/offline.js` returns the constant and enforcement
- [ ] New tests exist in `server/src/routes/offline.test.js` for tier-gated quality
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back if:
- The code at `server/src/routes/offline.js:180-210` doesn't match the excerpt (drifted)
- `resolveQualityFile` function signature or import has changed
- `request.accessTier` is not available in the offline route context (auth plugin not registered)
- The fix requires touching `server/src/routes/media.js`

## Maintenance notes

- If new quality tiers are added (e.g. "lossless"), the `ORIGINAL_QUALITY_MIN_TIER` constant should be shared between `media.js` and `offline.js` or extracted to `media-quality.js`.
- The `/api/offline/validate` endpoint (line 212) should also be checked if it ever gains download capabilities.
- Reviewer: confirm the fallback to `high` is the correct behavior vs returning 403. Falling back is friendlier for mobile offline sync which may not know the tier restriction.
