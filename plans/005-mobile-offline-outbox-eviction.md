# Plan 005: Evict Rejected Offline Events to Prevent Mobile Outbox Deadlock

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- server/src/routes/offline.js mobile/src/context/offline-context.jsx mobile/src/offline-store.js mobile/src/utils/offline.test.js`
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

The mobile offline audio feature records playback events and resume positions in SQLite when playing downloaded files without network connectivity. Upon reconnection, `offline-context.jsx:flushSync` submits pending outbox records to `/api/offline/sync`.

If a track has been deleted or is no longer accessible on the server, the server filters it out and returns only `acceptedEventIds`. The mobile client calls `deletePlaybackOutbox(result.acceptedEventIds || [])`, which leaves the unaccepted events in SQLite. Because `listPlaybackOutbox` selects the oldest 500 events (`ORDER BY created_at LIMIT 500`), the rejected events permanently occupy the queue. Once 500 rejected events accumulate, no new offline playback events can ever be synchronized to the server.

Fixing this by purging rejected event IDs and clearing dirty flags on rejected resumes prevents queue starvation.

## Current state

- `server/src/routes/offline.js:237-238`:
```javascript
const acceptedEvents = events.filter((event) => allowed.has(event.mediaId));
const acceptedEventIds = acceptedEvents.map((event) => event.clientEventId);
```
- `mobile/src/context/offline-context.jsx:175-179`:
```javascript
const result = await apiJson("/api/offline/sync", { method: "POST", body: JSON.stringify({ events, resumes }) });
await Promise.all([
  deletePlaybackOutbox(result.acceptedEventIds || []),
  markResumesSynced(result.acceptedResumeIds || []),
]);
```
- `mobile/src/offline-store.js:188`:
```javascript
const rows = await database.getAllAsync("SELECT client_event_id, payload_json FROM playback_outbox ORDER BY created_at LIMIT 500");
```

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `npm run test:mobile && npm run test:server` | exit 0, all pass |
| Lint      | `npm run lint`           | exit 0              |

## Scope

**In scope**:
- `server/src/routes/offline.js`
- `mobile/src/context/offline-context.jsx`
- `mobile/src/offline-store.js`
- `mobile/src/utils/offline.test.js`

**Out of scope**:
- Audio file download storage mechanism.

## Git workflow

- Branch: `advisor/005-mobile-offline-outbox-eviction`
- Commit message: `fix(offline): evict unaccepted sync items to prevent outbox deadlock`

## Steps

### Step 1: Return Rejected IDs in Server Offline Sync Endpoint

In `server/src/routes/offline.js`:
- In `POST /api/offline/sync`:
  - Calculate `rejectedEventIds = events.filter((e) => !allowed.has(e.mediaId)).map((e) => e.clientEventId)`.
  - Calculate `rejectedResumeIds = resumes.filter((r) => !allowed.has(r.mediaId)).map((r) => r.mediaId)`.
  - Return `{ acceptedEventIds, rejectedEventIds, acceptedResumeIds, rejectedResumeIds }` in response.

### Step 2: Clear Both Accepted and Rejected Items on Mobile

In `mobile/src/context/offline-context.jsx`:
- After successful `POST /api/offline/sync`, delete both accepted AND rejected event IDs from SQLite outbox:
```javascript
const eventsToDelete = [...(result.acceptedEventIds || []), ...(result.rejectedEventIds || [])];
const resumesToClear = [...(result.acceptedResumeIds || []), ...(result.rejectedResumeIds || [])];
await Promise.all([
  deletePlaybackOutbox(eventsToDelete),
  markResumesSynced(resumesToClear),
]);
```

### Step 3: Add Unit Tests

In `mobile/src/utils/offline.test.js` and `server/src/routes/offline.test.js`:
- Test that rejected events for deleted media are reported and purged.

## Done criteria

- [ ] `npm run lint` exits 0.
- [ ] `npm run test:server` and `npm run test:mobile` exit 0.
- [ ] Stale/rejected events do not remain in SQLite outbox after a sync attempt.

## STOP conditions

- If offline protocol requires a separate schema version for sync response payload, report before changing.
