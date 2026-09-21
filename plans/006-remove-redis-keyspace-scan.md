# Plan 006: Remove Full Redis Keyspace Scan on Active Session Polling

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- server/src/routes/playback.js server/src/routes/playback.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

The Web Dashboard polls `/api/playback/now-playing` every 5 seconds. In `server/src/routes/playback.js:762-770`, when there are no active sessions in the `ACTIVE_INDEX_KEY` sorted set (`ips.length === 0`), the endpoint falls back to a legacy migration loop using `redis.scan(cursor, "MATCH", "playback:active:*")`.

Whenever no streams are actively playing (the normal idle state of the media server), every single 5-second polling request triggers a full keyspace scan across all Redis keys. On production instances with thousands of keys, this saturates Redis CPU and elevates response latencies.

Fixing this by removing the obsolete runtime keyspace scan ensures idle polling completes in sub-millisecond time.

## Current state

- `server/src/routes/playback.js:759-776`:
```javascript
    let ips = await redis.zrangebyscore(ACTIVE_INDEX_KEY, now, "+inf");

    // One-release bridge for sessions written before the active-session index existed.
    if (ips.length === 0) {
      const legacyKeys = [];
      let cursor = "0";
      do {
        const result = await redis.scan(cursor, "MATCH", "playback:active:*", "COUNT", 50);
        cursor = result[0];
        legacyKeys.push(...result[1].filter((key) => key !== ACTIVE_INDEX_KEY));
      } while (cursor !== "0");
      ips = legacyKeys.map((key) => key.replace("playback:active:", ""));
      if (ips.length > 0) {
        const migration = redis.multi();
        for (const ip of ips) migration.zadd(ACTIVE_INDEX_KEY, now + 300_000, ip);
        await migration.exec();
      }
    }

    if (ips.length === 0) return [];
```

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `npm run test:server`    | exit 0, all pass    |
| Lint      | `npm run lint --workspace=server` | exit 0     |

## Scope

**In scope**:
- `server/src/routes/playback.js`
- `server/src/routes/playback.test.js`

**Out of scope**:
- Active session creation and heartbeat updates in `server/src/playback-session.js`.

## Git workflow

- Branch: `advisor/006-remove-redis-keyspace-scan`
- Commit message: `perf(playback): eliminate redis keyspace scan on idle active session polling`

## Steps

### Step 1: Remove Legacy SCAN Loop

In `server/src/routes/playback.js`:
- In `GET /active`:
  - Query `ips = await redis.zrangebyscore(ACTIVE_INDEX_KEY, now, "+inf");`.
  - Remove lines 761–776 (the legacy scan bridge).
  - If `ips.length === 0`, immediately return `[]`.

### Step 2: Use Pipeline for Session Key Retrieval

- When `ips.length > 0`, fetch the session data using `redis.mget(keys)` or pipeline instead of sequential queries.

### Step 3: Verify Tests

Run `npm run test:server`. Ensure all playback and now-playing tests pass.

## Done criteria

- [ ] `npm run lint --workspace=server` exits 0.
- [ ] `npm run test:server` exits 0.
- [ ] `redis.scan` is never called when active sessions list is empty.

## STOP conditions

- If any active test specifically tests the legacy fallback, update that test to reflect the index-backed resolution.
