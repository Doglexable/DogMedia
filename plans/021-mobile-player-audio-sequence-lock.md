# Plan 021: Prevent Audio Playback Overlap and Leaks with Sequence Guard in Mobile Player

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 50f1f36..HEAD -- mobile/src/context/player-context.jsx mobile/src/utils/player-state.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/015-fix-site-footer-rgb-tokens.md
- **Category**: bug
- **Planned at**: commit `50f1f36`, 2026-09-22

## Why this matters

In the mobile app, tapping a media item invokes `startMedia` and `loadAudio` in `mobile/src/context/player-context.jsx`. Both methods perform asynchronous operations: acquiring an exclusive playback session from the server (`createPlaybackSessionSource`), preparing local file URIs, and instantiating native audio players via Expo Audio (`createAudioPlayer`). When a user rapidly taps multiple tracks or skips forward quickly, these asynchronous operations resolve out of order. Without a sequence token, an earlier track can finish loading after a later track, instantiating a second active audio player. This causes two songs to play through the device speaker simultaneously, while the orphaned audio player instance cannot be paused or stopped from the UI.

## Current state

The relevant files:
- `mobile/src/context/player-context.jsx` — coordinates audio/video playback, queue state, and native audio players.
- `mobile/src/utils/player-state.js` — pure playback and queue state helpers.

Current-state excerpts:
`mobile/src/context/player-context.jsx:313-330`:
```javascript
    let source;
    try {
      source = localUri
        ? { uri: localUri }
        : await createPlaybackSessionSource(media.id, protectedQuality);
    } catch (error) {
      setPlaybackAccessError(error.message || "Playback is active on another device");
      throw error;
    }
    playbackSourceRef.current = localUri ? null : source;
    setPlaybackSource(localUri ? null : source);
    setPlaybackAccessError("");
    const sound = createAudioPlayer({ uri: source.uri, headers: source.headers }, { updateInterval: 500 });
    sound.volume = mutedRef.current ? 0 : volumeRef.current;
    sound.loop = false;
    soundRef.current = sound;
```

`mobile/src/context/player-context.jsx:398-421`:
```javascript
    await unloadSound();
    videoControllerRef.current = null;
    resumeLoadSequenceRef.current += 1;
    setResumePosition(null);
...
    const kind = getMediaKind(media.mime_type);
    if (kind === "audio") {
      pendingStartPositionRef.current = null;
      await loadAudio(media, autoplay, normalizedStart);
    }
```

Repo conventions:
- React state synchronization uses `useRef` sequence counters (e.g. `resumeLoadSequenceRef` already used for resume positions).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Mobile tests | `npm run test:mobile` | all 9 test files pass |
| Mobile lint | `npm run lint --workspace=mobile` | exit 0 |

## Scope

**In scope**:
- `mobile/src/context/player-context.jsx` — add `audioLoadSequenceRef`, check sequence before and after async session calls, and discard obsolete player instances.
- `mobile/src/utils/player-state.js` — helper for sequence checks if beneficial.

**Out of scope**:
- Video playback logic (`expo-video`).
- Offline database operations in `offline-store.js`.

## Git workflow

- Branch: `advisor/021-mobile-player-audio-sequence-lock`
- Commit style: `fix(mobile): add audio load sequence lock to prevent audio overlap and player leaks`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add audio load sequence counter in `mobile/src/context/player-context.jsx`

In `mobile/src/context/player-context.jsx`:
1. Add a ref near line 170:
   ```javascript
   const audioLoadSequenceRef = useRef(0);
   ```
2. In `loadAudio(media, autoplay = true, startPosition = 0)`:
   - Increment and capture the current sequence at the very beginning of the function:
     ```javascript
     const loadSequence = ++audioLoadSequenceRef.current;
     ```
   - After `await createPlaybackSessionSource(...)` (around line 318), check if the sequence is still active:
     ```javascript
     if (loadSequence !== audioLoadSequenceRef.current) return;
     ```
   - Before instantiating and playing `createAudioPlayer(...)` (around line 325), check again:
     ```javascript
     if (loadSequence !== audioLoadSequenceRef.current) return;
     ```
   - If a previous `soundRef.current` exists, ensure it is safely released:
     ```javascript
     if (soundRef.current && soundRef.current !== sound) {
       try { soundRef.current.remove?.(); } catch {}
     }
     ```
   - After seeking or playing, verify one final time that `loadSequence === audioLoadSequenceRef.current`; if stale, pause and remove the player immediately.

### Step 2: Invalidate sequence on stop and pause

In `stopPlayback` and `unloadSound`:
```javascript
audioLoadSequenceRef.current += 1;
```
This guarantees that any in-flight background `createPlaybackSessionSource` requests cannot start playback after the user explicitly pressed stop or pause.

### Step 3: Verify with mobile test suite and lint

**Verify**: `npm run test:mobile` → all pass.
**Verify**: `npm run lint --workspace=mobile` → exit 0.

## Test plan

- Verify rapid sequential calls to `startMedia` only play the final selected track.
- Verify `npm run test:mobile` exits cleanly.

## Done criteria

- [ ] `audioLoadSequenceRef` guards `loadAudio` across all async boundary points
- [ ] Obsolete audio player instances are discarded before `sound.play()`
- [ ] `npm run test:mobile` exits 0
- [ ] `npm run lint --workspace=mobile` exits 0

## STOP conditions

- If `sound.remove()` throws in the current Expo Audio release (wrap in safe optional call / try-catch).

## Maintenance notes

- Any future audio source loading (such as cached offline tracks or preview clips) must increment and check `audioLoadSequenceRef`.
