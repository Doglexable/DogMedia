# Plan 046: Restore Redis TTL on queue write paths

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/src/routes/queue.js server/src/routes/queue.test.js`
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

`QUEUE_TTL_SECONDS` documents a 7-day expiry for per-IP queue keys, and plan
030 fixed the delete path — but the four most common write paths never set any
TTL, so queues touched only through them become immortal: Redis memory leaks
and returning IPs resurrect week-old queues instead of starting fresh. After
this plan, every queue/index write carries the documented TTL.

## Current state

Relevant files:

- `server/src/routes/queue.js` — all per-IP queue routes; TTL constant at line 37.
- `server/src/routes/queue.test.js` — existing queue tests.

```js
// server/src/routes/queue.js:37
const QUEUE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
```

```js
// server/src/routes/queue.js:167-181 (replaceQueue — the CORRECT pattern to copy)
multi.expire(key, QUEUE_TTL_SECONDS);
multi.set(idxKey, startIndex, "EX", QUEUE_TTL_SECONDS);
```

```js
// server/src/routes/queue.js:439-452 — POST /items Lua script, NO expire
const queue = await fastify.redis.eval(
  `local items = redis.call('LRANGE', KEYS[1], 0, -1)
   for _, item in ipairs(items) do
     if item == ARGV[1] then return items end
   end
   redis.call('RPUSH', KEYS[1], ARGV[1])
   if #items == 0 then redis.call('SET', KEYS[2], 0) end
   table.insert(items, ARGV[1])
   return items`,
  2, key, idxKey, String(mediaId)
);
```

Bare index writes with no TTL (verified 2026-10-06):

- `queue.js:715` — `POST /next`: `await fastify.redis.set(idxKey, idx);`
- `queue.js:747` — `POST /prev`: `await fastify.redis.set(idxKey, idx);`
- `queue.js:782` — `POST /select`: `await fastify.redis.set(idxKey, idx);`

Also check `bumpQueueRevision` / `revisionKey` expiry at `queue.js:143`
(`await redis.expire(revisionKey, QUEUE_TTL_SECONDS)`) — mirror that for the
revision key on the paths you touch if it is missing there.

Repo conventions: `ioredis` (`set(k, v, "EX", secs)`, `expire(k, secs)`),
Lua via `redis.eval`. Tests use mocked redis harness in `queue.test.js`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Server tests | `npm run test:server` | all pass |
| Lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:

- `server/src/routes/queue.js`
- `server/src/routes/queue.test.js` (extend)

**Out of scope**:

- Atomicity of read-modify-write mutations (Lua compare-and-swap) — a known
  follow-up, explicitly NOT this plan. Only add expirations; do not restructure
  the logic.
- Queue size caps / windowing — not this plan.
- Any other Redis key families (`playback:*`, upload triggers).

## Git workflow

- Branch: `advisor/046-queue-ttl-write-paths`
- Message style: conventional commits, e.g. `fix(server): restore queue TTL on items/next/prev/select`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add EXPIRE to the POST /items Lua script

Add the TTL (pass `QUEUE_TTL_SECONDS` as an extra ARGV, or hardcode the same
computed value — prefer ARGV so the constant stays single-sourced):

- `redis.call('EXPIRE', KEYS[1], ARGV[2])` after RPUSH (and on the early-return
  dedup path too — a re-add of an existing item must also refresh TTL).
- `redis.call('SET', KEYS[2], 0, 'EX', ARGV[2])` for the fresh-queue branch;
  when the queue already exists, `redis.call('EXPIRE', KEYS[2], ARGV[2])`.

Note: the Lua script returns early when the item already exists — add EXPIRE
before that `return` as well.

**Verify**: `npm run test:server -- queue` (or full `npm run test:server`) → pass.

### Step 2: Add EX to the next/prev/select index writes

Change the three bare writes to include the TTL:

- `queue.js:715` (next), `:747` (prev), `:782` (select):
  `await fastify.redis.set(idxKey, idx, "EX", QUEUE_TTL_SECONDS);`
- Also refresh the list key TTL alongside: after each, add
  `await fastify.redis.expire(key, QUEUE_TTL_SECONDS).catch(() => {});`
  where `key` is in scope (next/prev/select all have `key` — verify at each
  site; note the `.catch(() => {})` style used at `queue.js:705` for
  best-effort ops — match the surrounding style, but these three sites
  currently await without catch; keep their style, just add the calls).
- Ensure `bumpQueueRevision` already refreshes the revision key on these paths
  (it is called at all three sites); if `queueRevision` reads show otherwise,
  add the expire — but do not change revision semantics.

**Verify**: `npm run test:server` → all pass.

### Step 3: Add TTL regression tests

Extend `server/src/routes/queue.test.js`:

- After `POST /items` on a fresh IP: `TTL key > 0` and `TTL idxKey > 0`
  (if the mock supports TTL inspection — check the mock first; if it does not,
  assert via `expire`/`set` call args on the mock instead).
- After `POST /next`, `/prev`, `/select`: index key TTL is set/refreshed.
- Re-adding an existing item via `POST /items` refreshes TTL (covers the
  early-return branch from step 1).

**Verify**: `npm run test:server` → all pass including new tests.

## Test plan

- New TTL assertions in `queue.test.js` per step 3, following the existing
  mocked-redis harness in that file.
- Full suite green; lint clean.

## Done criteria

- [ ] `npm run test:server` exits 0 with new TTL tests passing
- [ ] `grep -n "redis.set(idxKey, idx)" server/src/routes/queue.js` returns no
      bare (TTL-less) index writes
- [ ] Lua script in `POST /items` contains EXPIRE for both KEYS
- [ ] `npm run lint --workspace=server` exits 0
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Current-state excerpts don't match live code (drift).
- The mocked redis in tests cannot observe TTL and no reasonable assertion is
  possible — stop and report rather than shipping untested changes.
- Verification fails twice after reasonable fix attempts.
- Fix requires touching out-of-scope files.

## Maintenance notes

- Every future queue mutation must set `EX`/`EXPIRE` with `QUEUE_TTL_SECONDS`
  on all three keys (list, index, revision) — reviewer checklist item.
- The remaining known issue on these paths is non-atomic read-modify-write
  (lost updates under same-viewer concurrency); that is a separate M-effort
  Lua-CAS plan, not to be attempted here.
