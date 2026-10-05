# Plan 036: Prune historical playback events in Redis to prevent unbounded memory growth

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat edc7905..HEAD -- server/src/routes/playback.js`
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

## Why this matters

The `playback:events` sorted set in Redis grows monotonically with every playback event from every client. Events are added via `zadd` without any trimming, TTL, or eviction. Over time — especially with continuous playback from multiple clients — Redis memory is exhausted, causing writes to fail across all services that depend on Redis (queues, sessions, uploads, encoding).

Playback events are also persisted to PostgreSQL via `storePlaybackEvent`, so the Redis sorted set serves only as a short-term buffer for dashboard queries and Wrapped analytics. Events older than 90 days have no operational purpose in Redis.

## Current state

Relevant files:
- `server/src/routes/playback.js` — playback event ingestion and dashboard queries

**`server/src/routes/playback.js:536-540`** (event added without trimming):
```javascript
    const eventsKey = "playback:events";

    const redis = getRedis(fastify);
    const multi = redis.multi();
    multi.zadd(eventsKey, now, JSON.stringify(event));
```

No `zremrangebyscore` or similar cleanup exists anywhere in the file or codebase for this key.

**Repo conventions**: Redis operations use `multi` transactions. Cleanup operations are co-located with the write operation or in a scheduled cleanup function (see `server/src/media-cleanup.js` for the pattern).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Server tests | `npm run test:server` | exit 0, all pass |
| All tests | `npm run test` | exit 0, all pass |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `server/src/routes/playback.js`

**Out of scope** (do NOT touch):
- `server/src/routes/offline.js` — its event ingestion also adds to `playback:events` but the trimming in the main route will cover both
- Dashboard query consumers — they already use `zrangebyscore` with time bounds

## Git workflow

- Branch: `fix/036-playback-events-redis-ttl`
- Commit style: `fix(server): prune old playback events from Redis sorted set`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a trimming constant and cleanup after event ingestion

In `server/src/routes/playback.js`, near the top of the file (with other constants), add:

```javascript
const PLAYBACK_EVENTS_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
```

Then in the `POST /event` handler, after the `multi.zadd(eventsKey, now, ...)` line (line 540) and before `await multi.exec()` (line 554), add:

```javascript
    multi.zremrangebyscore(eventsKey, "-inf", now - PLAYBACK_EVENTS_RETENTION_MS);
```

This piggybacks the cleanup on every event write inside the existing `multi` transaction, removing events older than 90 days atomically.

**Verify**: `grep 'zremrangebyscore' server/src/routes/playback.js` → shows the trimming call

### Step 2: Run tests

**Verify**: `npm run test` → exit 0
**Verify**: `npm run lint` → exit 0

## Test plan

No new test file needed. The `zremrangebyscore` call is a single Redis command piggybacked on the existing multi transaction. The existing playback event tests use mock Redis; adding a mock assertion for the trimming call is optional but low-value.

## Done criteria

- [ ] `npm run test` exits 0
- [ ] `npm run lint` exits 0
- [ ] `grep 'zremrangebyscore' server/src/routes/playback.js` returns a match
- [ ] `grep 'PLAYBACK_EVENTS_RETENTION_MS' server/src/routes/playback.js` returns a match
- [ ] No files outside the in-scope list are modified

## STOP conditions

Stop and report back if:
- The event ingestion at playback.js:536-554 doesn't match the excerpt
- The `multi` transaction pattern has changed
- The `playback:events` key name has changed

## Maintenance notes

- The 90-day retention window aligns with the Wrapped analytics lookback period. If Wrapped's window changes, update `PLAYBACK_EVENTS_RETENTION_MS`.
- The offline sync route (`offline.js:309`) also adds to `playback:events` but does not need its own trimming — the main route's periodic cleanup is sufficient.
- If event volume is extremely high, consider a cron-based cleanup instead of per-write trimming. For the expected scale of a private media server, per-write is efficient.

## Implementation

Completed on 2026-10-04. Each playback event transaction now removes sorted-set
entries scored before the 90-day retention cutoff immediately after adding the
new event, preventing `playback:events` from growing without bounds.
