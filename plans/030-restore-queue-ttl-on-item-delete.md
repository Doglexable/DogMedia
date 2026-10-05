# Plan 030: Restore Redis queue key TTL after item deletion

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat edc7905..HEAD -- server/src/routes/queue.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `edc7905`, 2026-10-04
- **Implementation**: Completed on 2026-10-04. Item deletion now restores the
  seven-day expiry on both the rebuilt queue list and its index key.

## Why this matters

When a user removes an item from their playback queue via `DELETE /api/queue/items/:mediaId`, the handler deletes and recreates the Redis list and index keys without re-applying the 7-day TTL (`QUEUE_TTL_SECONDS`). This makes the keys permanent (`TTL = -1`), causing them to persist in Redis indefinitely. Over time, every unique IP that ever mutated a queue item leaks two permanent keys, growing Redis memory without bound.

The correct pattern already exists in the `replaceQueue` helper function (lines 131-145) which properly applies `expire` after `rpush`. The delete handler bypasses this helper.

## Current state

Relevant files:
- `server/src/routes/queue.js` — queue management routes (line 31: `QUEUE_TTL_SECONDS = 7 * 24 * 60 * 60`)

**`server/src/routes/queue.js:31`** (TTL constant):
```javascript
const QUEUE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
```

**`server/src/routes/queue.js:131-145`** (correct pattern in `replaceQueue`):
```javascript
async function replaceQueue(redis, key, idxKey, ids, startId) {
  const startIndex = Math.max(startId === null ? 0 : ids.indexOf(startId), 0);
  const multi = redis.multi();
  multi.del(key);
  multi.del(idxKey);

  if (ids.length > 0) {
    multi.rpush(key, ...ids);
    multi.expire(key, QUEUE_TTL_SECONDS);
    multi.set(idxKey, startIndex, "EX", QUEUE_TTL_SECONDS);
  }

  await multi.exec();
  return startIndex;
}
```

**`server/src/routes/queue.js:545-552`** (broken — missing TTL after rebuild):
```javascript
    const multi = fastify.redis.multi();
    multi.del(key);
    multi.del(idxKey);
    if (nextQueue.length > 0) {
      multi.rpush(key, ...nextQueue);
      multi.set(idxKey, nextIndex);
    }
    await multi.exec();
```

**Repo conventions**: Redis multi transactions are used throughout `queue.js`. The `QUEUE_TTL_SECONDS` constant is already defined and used in `replaceQueue` and `bumpQueueRevision`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Server tests | `npm run test:server` | exit 0, all pass |
| All tests | `npm run test` | exit 0, all pass |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `server/src/routes/queue.js`

**Out of scope** (do NOT touch):
- `server/src/routes/queue.test.js` — existing tests don't cover TTL; adding Redis TTL assertions would require a real Redis instance
- Any other route files

## Git workflow

- Branch: `fix/030-queue-ttl-on-delete`
- Commit style: `fix(server): restore queue key TTL after item deletion`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add expire calls to the delete item handler

In `server/src/routes/queue.js`, find the `DELETE /items/:mediaId` handler around line 545-552. After the `multi.rpush` and `multi.set` lines inside the `if (nextQueue.length > 0)` block, add TTL expiration matching the `replaceQueue` pattern:

Change:
```javascript
    if (nextQueue.length > 0) {
      multi.rpush(key, ...nextQueue);
      multi.set(idxKey, nextIndex);
    }
```

To:
```javascript
    if (nextQueue.length > 0) {
      multi.rpush(key, ...nextQueue);
      multi.expire(key, QUEUE_TTL_SECONDS);
      multi.set(idxKey, nextIndex, "EX", QUEUE_TTL_SECONDS);
    }
```

**Verify**: `grep -A2 'multi.rpush(key, ...nextQueue)' server/src/routes/queue.js` → shows `multi.expire(key, QUEUE_TTL_SECONDS)` on the next line

### Step 2: Verify no other TTL-missing paths exist

**Verify**: `grep -n 'multi.rpush' server/src/routes/queue.js` → every `rpush` should have a corresponding `expire` within 1-2 lines. Check the output and confirm.

### Step 3: Run tests

**Verify**: `npm run test` → exit 0, all tests pass
**Verify**: `npm run lint` → exit 0

## Test plan

No new test files needed for this plan. The fix is a two-line addition matching an established pattern. The existing queue tests verify queue behavior; TTL verification would require a real Redis instance which is out of scope.

## Done criteria

- [ ] `npm run test` exits 0
- [ ] `npm run lint` exits 0
- [ ] `grep -c 'QUEUE_TTL_SECONDS' server/src/routes/queue.js` returns at least 6 (was 4)
- [ ] Every `multi.rpush` call in `queue.js` has a corresponding `multi.expire` within 2 lines
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back if:
- The `DELETE /items/:mediaId` handler at lines 545-552 doesn't match the excerpt
- The `QUEUE_TTL_SECONDS` constant is missing or has been moved
- The `replaceQueue` function pattern has changed
- Any other queue mutation path also appears to be missing TTL

## Maintenance notes

- Future queue mutation handlers (reorder, bulk operations) must follow the `replaceQueue` TTL pattern.
- Consider refactoring the delete handler to use `replaceQueue` directly instead of manual multi operations — this would prevent future TTL omissions. Deferred from this plan to minimize scope.
