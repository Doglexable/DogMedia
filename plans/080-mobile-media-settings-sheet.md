# Plan 080: Port Web Media Settings Sheet (Quality, Speed, Sleep Timer) to Mobile Client

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43d7dd5..HEAD -- mobile/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `43d7dd5`, 2026-10-28

## Why this matters

The Web client features a unified, tabbed `SettingsControl` (`web/src/components/global-player/settings-panel.jsx`) that lets users seamlessly switch media quality (with bitrate and available rendition badges), adjust playback speed (0.5x to 2x for both audio and video), configure sleep timers (presets and live countdown), and review audio presets.

On Mobile (`mobile/`), media settings are fragmented:
1. Quality is controlled only via a bare inline pill (`QualityControl` in `mobile/src/components/full-player.jsx:44-60`) that simply cycles qualities without showing bitrate badges or checking server capability.
2. Playback speed adjustment is completely absent, despite `expo-audio` (`AudioPlayer.playbackRate`) and `expo-video` (`VideoPlayer.playbackRate`) supporting variable speed natively.
3. The sleep timer options are only accessible in the video view and lack a unified modal presentation for audio tracks.

Porting the Web media settings experience to Mobile via a dedicated bottom sheet (`MediaSettingsSheet`) brings feature parity, clean tabbed UX, and variable playback speed across all mobile media sessions.

## Current state

- `web/src/components/global-player/settings-panel.jsx` — Reference implementation of Web's tabbed settings control.
  - Tabs: Quality (`ori`, `high`, `med`, `low`), Speed (`0.5x`, `0.75x`, `1x`, `1.25x`, `1.5x`, `2x`), Sleep Timer (`5m`, `15m`, `30m`, `45m`, `60m`, End of Track).
- `mobile/src/components/full-player.jsx` — Monolithic full-screen player for audio and video.
  - Contains inline `QualityControl` (lines 44–60) and `SleepTimerOptions` (lines 153–190).
- `mobile/src/context/player-context.jsx` — Core playback coordinator for Expo Audio and Video.
  - Manages `quality`, `actualQuality`, `changeQuality`, `sleepTimerRemaining`, and `setSleepTimer`.
  - Currently lacks `playbackRate` state and speed setters for `soundRef` and `videoControllerRef`.
- `mobile/src/media-quality.js` — Client-side quality normalization and AsyncStorage persistence.

### Relevant code excerpts

`mobile/src/components/full-player.jsx:44-59`:
```jsx
function QualityControl({ player, style, styles }) {
  const qualities = player.currentMedia?.available_qualities?.includes("ori")
    ? ["low", "med", "high", "ori"]
    : ["low", "med", "high"];
  return (
    <Pressable
      accessibilityLabel={`Media quality ${player.quality}, playing ${player.actualQuality}`}
      accessibilityRole="button"
      onPress={() => {
        player.changeQuality(qualities[(qualities.indexOf(player.quality) + 1) % qualities.length]);
      }}
      style={[styles.qualityPill, style]}
    >
      <Text style={styles.qualityText}>{player.quality.toUpperCase()}{player.actualQuality !== player.quality ? ` → ${player.actualQuality.toUpperCase()}` : ""}</Text>
    </Pressable>
  );
}
```

`mobile/src/context/player-context.jsx:79-94` (Video controller registration):
```jsx
    return playerState.registerVideoController({
      pause: () => player.pause(),
      play: () => player.play(),
      seek: (seconds) => {
        player.currentTime = seconds;
      },
      setLoop: (enabled) => {
        player.loop = enabled;
      },
      setVolume: (nextVolume) => {
        player.volume = nextVolume;
      },
    });
```

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Lint      | `npm run lint --workspace=mobile` | exit 0 |
| Tests     | `npm run test:mobile` | all pass (exit 0) |

## Scope

**In scope**:
- `mobile/src/context/player-context.jsx` — Add `playbackRate` state (default 1.0), expose `setPlaybackRate`, and propagate rate to active `expo-audio` player and video controller.
- `mobile/src/components/media-settings-sheet.jsx` (create) — Bottom sheet modal with tabs: Quality, Speed, Sleep Timer. Matches Dogmedia mobile theme (`mobile/src/theme.js`).
- `mobile/src/components/full-player.jsx` — Replace inline `QualityControl` and standalone sleep button with a unified Gear/Settings icon button opening `MediaSettingsSheet`.
- `mobile/src/components/media-settings-sheet.test.jsx` (create) — Automated unit tests covering sheet tabs, quality selection, rate changes, and sleep timer dispatch.

**Out of scope**:
- Native audio DSP / Equalizer hardware bindings (Expo SDK does not provide a 10-band audio filter node; keep EQ as future native module if needed).
- Changes to server streaming endpoints or desktop code.

## Git workflow

- Branch: `feature/080-mobile-media-settings-sheet`

## Implementation steps

### Step 1: Extend `PlayerContext` with Playback Rate Support

1. In `mobile/src/context/player-context.jsx`:
   - Add state: `const [playbackRate, setPlaybackRateState] = useState(1.0);`.
   - Create `setPlaybackRate = useCallback((rate) => { ... }, []);`.
   - When `soundRef.current` is active, apply rate: `soundRef.current.playbackRate = rate;` (or `setPlaybackRate(rate)`).
   - In `videoControllerRef.current`, support `setPlaybackRate: (rate) => { player.playbackRate = rate; }`.
   - Reset `playbackRate` to `1.0` when switching tracks unless persisted.
   - Expose `playbackRate` and `setPlaybackRate` in `PlayerContext.Provider` value.

**Verification**:
```bash
npm run test:mobile
```
Expected: All existing mobile tests pass.

---

### Step 2: Implement `MediaSettingsSheet` Component

Create `mobile/src/components/media-settings-sheet.jsx`:
1. Use React Native `Modal` with backdrop blur / semi-transparent overlay and slide animation.
2. Implement 3 tabs:
   - **Quality**: Renders options `Very High (ori)`, `High (high)`, `Medium (med)`, `Low (low)` with resolution/bitrate badges. Highlights `player.quality` and shows `player.actualQuality` fallback indicator.
   - **Speed**: Renders selectable pills: `0.5x`, `0.75x`, `1.0x (Normal)`, `1.25x`, `1.5x`, `2.0x`.
   - **Sleep Timer**: Renders preset buttons `5m`, `15m`, `30m`, `45m`, `60m`, and "Turn off". Shows remaining countdown if active.
3. Include header with title "Playback Settings" and close button (✕).
4. Follow styling conventions from `mobile/src/theme.js` (colors: `surface`, `card`, `primary`, `text`, `muted`).

**Verification**:
```bash
npm run lint --workspace=mobile
```
Expected: No ESLint errors.

---

### Step 3: Integrate Settings Button in `FullPlayer`

In `mobile/src/components/full-player.jsx`:
1. Add state `const [settingsOpen, setSettingsOpen] = useState(false);`.
2. In the full player top action bar (for both audio and video), render a Settings Gear button (`Ionicons name="settings-outline"`).
3. Mount `<MediaSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} player={player} />`.
4. Ensure sleep timer badge is reflected on the settings icon when a timer is active.

**Verification**:
```bash
npm run test:mobile
```
Expected: All tests pass.

---

### Step 4: Add Unit Tests for Settings Sheet

Create `mobile/src/components/media-settings-sheet.test.jsx`:
1. Test tab navigation: Quality, Speed, Sleep Timer.
2. Test calling `player.changeQuality("high")` upon selecting High quality.
3. Test calling `player.setPlaybackRate(1.5)` upon selecting 1.5x.
4. Test calling `player.setSleepTimer(30)` upon selecting 30m.

**Verification**:
```bash
npm run test:mobile
```
Expected: All tests pass including the new suite.

---

## Machine-checkable done criteria

1. `npm run lint --workspace=mobile` exits with code 0.
2. `npm run test:mobile` passes completely.
3. `mobile/src/components/media-settings-sheet.jsx` exists and exports the modal component.

## STOP conditions

- If `expo-audio` throws unhandled exceptions when setting `playbackRate`, stop and verify whether `player.playbackRate = rate` is supported on the installed expo-audio version.
- If existing sleep timer tests in `mobile/src/components/sleep-timer-complete-modal.jsx` fail, do not alter modal eviction contracts.
