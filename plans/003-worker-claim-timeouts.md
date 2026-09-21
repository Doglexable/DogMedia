# Plan 003: Increase Stream Claim Idle Timeouts in Encoding and Music Reel Workers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- server/src/encoding-worker.js server/src/music-reel-worker.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

In `server/src/encoding-worker.js` and `server/src/music-reel-worker.js`, `xautoclaim` reclaims pending messages from Redis Streams using `DEFAULT_IDLE_MS` / `IDLE_MS = 60_000` (60 seconds). Video encoding and reel rendering regularly take several minutes for HD/4K videos and feature films. When an encoding job takes more than 60 seconds, another worker consumer reclaims the same message while the first worker is still actively encoding with ffmpeg.

This causes parallel duplicate transcoding of the same file, double CPU and memory consumption, potential file write collisions, and premature depletion of maximum retry attempts.

Fixing this by increasing the claim idle timeout (e.g. to 1 hour, configurable via environment variable) prevents active transcoding jobs from being stolen.

## Current state

- `server/src/encoding-worker.js:10`:
```javascript
const DEFAULT_IDLE_MS = 60_000;
```
- `server/src/encoding-worker.js:296`:
```javascript
const reclaimed = await redis.xautoclaim(ENCODING_STREAM, ENCODING_GROUP, consumer, DEFAULT_IDLE_MS, "0-0", "COUNT", 1);
```
- `server/src/music-reel-worker.js:15`:
```javascript
const IDLE_MS = 60_000;
```
- `server/src/music-reel-worker.js:394`:
```javascript
const reclaimed = await redis.xautoclaim(STREAM_NAME, GROUP_NAME, consumer, IDLE_MS, "0-0", "COUNT", 1);
```

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `npm run test:server`    | exit 0, all pass    |
| Lint      | `npm run lint --workspace=server` | exit 0     |

## Scope

**In scope**:
- `server/src/encoding-worker.js`
- `server/src/music-reel-worker.js`
- `server/src/music-reel-worker.test.js`

**Out of scope**:
- Stream consumer group creation logic.

## Git workflow

- Branch: `advisor/003-worker-claim-timeouts`
- Commit message: `fix(worker): increase stream claim idle timeout to prevent duplicate transcoding`

## Steps

### Step 1: Update Idle Timeouts in Workers

1. In `server/src/encoding-worker.js`:
   - Change `DEFAULT_IDLE_MS` to default to `Number.parseInt(process.env.ENCODING_WORKER_CLAIM_IDLE_MS || "3600000", 10)` (1 hour).
2. In `server/src/music-reel-worker.js`:
   - Change `IDLE_MS` to default to `Number.parseInt(process.env.MUSIC_REEL_WORKER_CLAIM_IDLE_MS || "1800000", 10)` (30 minutes).

### Step 2: Verify Existing Tests

Run `npm run test:server`. Ensure all worker tests pass.

## Done criteria

- [ ] `npm run lint --workspace=server` exits 0.
- [ ] `npm run test:server` exits 0.
- [ ] Idle timeout for encoding and music reel stream claims exceeds 30 minutes.

## STOP conditions

- If tests mock `xautoclaim` with exact 60000ms argument checks, update the mock assertions to match the new constant.
