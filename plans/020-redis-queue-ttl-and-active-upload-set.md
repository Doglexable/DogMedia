# Plan 020: Enforce TTL on Redis Queue Keys and Replace Keyspace SCAN in Upload Queue

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 50f1f36..HEAD -- server/src/upload-completion-queue.js server/src/routes/media.js server/src/routes/queue.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/015-fix-site-footer-rgb-tokens.md
- **Category**: perf
- **Planned at**: commit `50f1f36`, 2026-09-22

## Why this matters

The Redis cache currently suffers from two distinct efficiency issues. First, `server/src/routes/media.js` implements `GET /uploads/queue` by executing a full Redis keyspace `SCAN` matching `media:upload-completion:*` on every poll from the Admin UI. As the number of keys in Redis grows, `SCAN` causes single-threaded event loop latency spikes. Second, per-IP queue keys (`queue:${ip}`, `queue:index:${ip}`, and `queue:revision:${ip}`) in `server/src/routes/queue.js` are created without expiration (`EX`), causing Redis memory to grow monotonically with every unique client IP that ever connects. Tracking active upload IDs in a Redis set (`media:upload-completion:active_ids`) and setting a 7-day TTL on queue keys resolves both problems.

## Current state

The relevant files:
- `server/src/upload-completion-queue.js` — writes and manages upload completion status in Redis.
- `server/src/routes/media.js` — `GET /uploads/queue` endpoint that scans Redis.
- `server/src/routes/queue.js` — manages per-IP playback queue lists and revisions.

Current-state excerpts:
`server/src/routes/media.js:960-973`:
```javascript
    let cursor = "0";
    const keys = [];
    do {
      const result = await fastify.redis.scan(
        cursor,
        "MATCH",
        `${UPLOAD_COMPLETION_STATUS_PREFIX}*`,
        "COUNT",
        100
      );
      cursor = String(result?.[0] || "0");
      keys.push(...(result?.[1] || []));
    } while (cursor !== "0");
```

`server/src/routes/queue.js:101-104`:
```javascript
async function bumpQueueRevision(redis, revisionKey) {
  if (typeof redis.incr !== "function") return 0;
  return Number(await redis.incr(revisionKey));
}
```

`server/src/routes/queue.js:125-138`:
```javascript
async function replaceQueue(redis, key, idxKey, ids, startId) {
  const startIndex = Math.max(startId === null ? 0 : ids.indexOf(startId), 0);
  const multi = redis.multi();
  multi.del(key);
  multi.del(idxKey);

  if (ids.length > 0) {
    multi.rpush(key, ...ids);
    multi.set(idxKey, startIndex);
  }

  await multi.exec();
  return startIndex;
}
```

Repo conventions:
- Follow Plan 006 exemplar (`playback:active:ips` set) for tracking active resource keys without full keyspace scans.
- Per-IP temporary state uses 7-day TTL (`7 * 24 * 60 * 60 = 604,800` seconds).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server tests | `npm run test:server` | all pass |
| Queue tests only | `npm run test:server -- queue` | all pass |
| Server lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:
- `server/src/upload-completion-queue.js` — track active upload IDs in Redis set `media:upload-completion:active_ids`.
- `server/src/routes/media.js` — query active IDs from set rather than scanning the keyspace in `GET /uploads/queue`.
- `server/src/routes/queue.js` — add 7-day TTL (`expire`) to queue, index, and revision keys.

**Out of scope**:
- Fastify route parameter contracts or response schemas.
- Changing `playback_events` table in PostgreSQL.

## Git workflow

- Branch: `advisor/020-redis-queue-ttl-and-active-upload-set`
- Commit style: `perf(server): track active upload IDs in set and enforce TTL on Redis queue keys`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Track active upload IDs in `server/src/upload-completion-queue.js`

In `server/src/upload-completion-queue.js`:
1. Export constant:
   ```javascript
   export const UPLOAD_COMPLETION_ACTIVE_IDS_KEY = "media:upload-completion:active_ids";
   ```
2. In `writeUploadCompletionStatus(redis, uploadId, value)`:
   - If `value.status === "queued"` or `value.status === "processing"`, add `uploadId` to the active set:
     ```javascript
     if (typeof redis.sadd === "function") {
       await redis.sadd(UPLOAD_COMPLETION_ACTIVE_IDS_KEY, uploadId).catch(() => {});
     }
     ```
   - If `value.status === "completed"` or `value.status === "failed"`, remove `uploadId` from the active set:
     ```javascript
     if (typeof redis.srem === "function") {
       await redis.srem(UPLOAD_COMPLETION_ACTIVE_IDS_KEY, uploadId).catch(() => {});
     }
     ```

### Step 2: Query active IDs in `server/src/routes/media.js`

In `server/src/routes/media.js:960-975`, replace the `fastify.redis.scan` loop with:
```javascript
    let keys = [];
    if (typeof fastify.redis.smembers === "function") {
      const activeIds = await fastify.redis.smembers(UPLOAD_COMPLETION_ACTIVE_IDS_KEY);
      keys = (activeIds || []).map((id) => uploadCompletionStatusKey(id));
    }
```
If `keys` is empty, return `{ items: [] }` immediately without calling `mget`.

### Step 3: Add 7-day TTLs in `server/src/routes/queue.js`

In `server/src/routes/queue.js`:
1. Define constant:
   ```javascript
   const QUEUE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
   ```
2. In `replaceQueue`:
   When `ids.length > 0`, set expiration on both keys in the multi transaction:
   ```javascript
   multi.rpush(key, ...ids);
   multi.expire(key, QUEUE_TTL_SECONDS);
   multi.set(idxKey, startIndex, "EX", QUEUE_TTL_SECONDS);
   ```
3. In `bumpQueueRevision`:
   After `incr`, set TTL on the revision key:
   ```javascript
   const revision = Number(await redis.incr(revisionKey));
   await redis.expire(revisionKey, QUEUE_TTL_SECONDS).catch(() => {});
   return revision;
   ```

### Step 4: Verify with test suite

**Verify**: `npm run test:server -- queue` → all pass.
**Verify**: `npm run test:server` → all pass.

## Test plan

- Verify that `replaceQueue` sets expiration on keys without altering returned queue items.
- Verify `GET /uploads/queue` returns active items from `smembers` without calling `scan`.
- Run `npm run test:server` to verify no regressions.

## Done criteria

- [ ] `fastify.redis.scan` is removed from `GET /uploads/queue`
- [ ] Active upload IDs are maintained in `media:upload-completion:active_ids`
- [ ] Queue keys in Redis expire after 7 days of inactivity
- [ ] `npm run test:server` exits 0
- [ ] `npm run lint --workspace=server` exits 0

## STOP conditions

- If Redis mock in tests lacks `sadd`, `srem`, or `smembers` (add mock stubs in `queue.test.js` or `media.test.js` if needed).

## Maintenance notes

- Any additional per-IP Redis keys introduced in future features must specify an explicit TTL to avoid memory leaks.
