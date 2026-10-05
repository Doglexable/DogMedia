# Plan 033: Guard Redis resume value JSON parsing against corrupted entries

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat edc7905..HEAD -- server/src/routes/playback.js server/src/routes/offline.js`
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

## Why this matters

Two endpoints use bare `JSON.parse()` on Redis string values without error handling. If a resume key contains corrupted, truncated, or legacy non-JSON data, these endpoints throw unhandled `SyntaxError` exceptions, returning 500 Internal Server Errors to clients instead of gracefully treating corrupted entries as cache misses.

## Current state

Relevant files:
- `server/src/routes/playback.js` — playback event and resume routes
- `server/src/routes/offline.js` — offline sync routes

**`server/src/routes/playback.js:722-728`**:
```javascript
  fastify.get("/resume/:mediaId", async (request) => {
    const redis = getRedis(fastify);
    const { mediaId } = request.params;
    const key = `playback:resume:${request.clientIp || request.ip}:${mediaId}`;
    const raw = await redis.get(key);
    if (!raw) return { position: null };
    return JSON.parse(raw);
  });
```

**`server/src/routes/offline.js:331-332`**:
```javascript
      const remoteRaw = remoteValues[index];
      const remote = remoteRaw ? JSON.parse(remoteRaw) : null;
```

**Repo conventions**: Error handling in routes typically uses `try/catch` with `request.log.warn()` for non-fatal issues. See `server/src/routes/subtitles.js:60-62` for the logging pattern.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Server tests | `npm run test:server` | exit 0, all pass |
| All tests | `npm run test` | exit 0, all pass |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `server/src/routes/playback.js`
- `server/src/routes/offline.js`
- `server/src/routes/playback.test.js` (add test case)

**Out of scope** (do NOT touch):
- The `JSON.stringify` calls that write resume data — those are correct
- `server/src/playback-session.js` — different module

## Git workflow

- Branch: `fix/033-guard-resume-json-parse`
- Commit style: `fix(server): guard JSON.parse on Redis resume values against corrupted entries`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a safe parse helper or inline try/catch in playback.js

In `server/src/routes/playback.js`, change the `GET /resume/:mediaId` handler at line 728.

Change:
```javascript
    return JSON.parse(raw);
```

To:
```javascript
    try {
      return JSON.parse(raw);
    } catch {
      request.log.warn({ key }, "corrupted resume entry in Redis, treating as cache miss");
      return { position: null };
    }
```

**Verify**: `grep -A3 'return JSON.parse(raw)' server/src/routes/playback.js` → shows try/catch wrapper

### Step 2: Add safe parse in offline.js

In `server/src/routes/offline.js`, change line 332.

Change:
```javascript
      const remote = remoteRaw ? JSON.parse(remoteRaw) : null;
```

To:
```javascript
      let remote = null;
      if (remoteRaw) {
        try {
          remote = JSON.parse(remoteRaw);
        } catch {
          // Treat corrupted resume as absent — offline client's value will take precedence
        }
      }
```

**Verify**: `grep -A5 'remoteRaw' server/src/routes/offline.js` → shows try/catch wrapper

### Step 3: Add test for corrupted resume handling

In `server/src/routes/playback.test.js`, add a test case that mocks `redis.get()` returning an invalid JSON string (e.g. `"not-json"`) and verifies the handler returns `{ position: null }` instead of throwing.

Follow the existing test pattern in `server/src/routes/playback.test.js` for mock setup.

**Verify**: `npm run test:server` → all pass including new test

### Step 4: Final verification

**Verify**: `npm run test` → exit 0
**Verify**: `npm run lint` → exit 0

## Test plan

- New test in `server/src/routes/playback.test.js`:
  - `GET /playback/resume/:mediaId` with corrupted Redis value → returns `{ position: null }`
- Model after existing tests in `server/src/routes/playback.test.js`.
- Verification: `npm run test:server` → all pass

## Done criteria

- [ ] `npm run test` exits 0
- [ ] `npm run lint` exits 0
- [ ] No bare `JSON.parse(raw)` or `JSON.parse(remoteRaw)` exists in playback.js or offline.js resume handlers
- [ ] New test exists for corrupted resume value
- [ ] No files outside the in-scope list are modified

## STOP conditions

Stop and report back if:
- The resume handler at playback.js:722-728 doesn't match the excerpt
- The offline sync handler at offline.js:328-336 doesn't match the excerpt
- `getRedis` function or Redis mock pattern has changed

## Maintenance notes

- Any future `JSON.parse` on Redis-stored values should use the same defensive pattern.
- If a `safeParse` utility is added to the project, these sites should be refactored to use it.

## Implementation

Completed on 2026-10-04. Corrupted Redis resume values are now treated as cache
misses by the playback route and as absent remote state during offline sync. A
route regression test verifies that invalid JSON returns `{ position: null }`
instead of a server error.
