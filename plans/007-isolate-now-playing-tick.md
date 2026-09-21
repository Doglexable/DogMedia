# Plan 007: Isolate 1-Second Now-Playing Interval to Avoid Full Dashboard Re-Renders

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- web/src/pages/Dashboard.jsx web/src/components/dashboard/ web/src/components/MagicBento.jsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

In `web/src/pages/Dashboard.jsx:742`, state `nowPlayingRenderNow` is held at the root level of `Dashboard`. An effect runs a 1,000ms `setInterval` updating `nowPlayingRenderNow = Date.now()` every second whenever active playback sessions exist.

Because this state lives at the top level of the 1,224-line `Dashboard` component, every 1-second tick causes the entire Dashboard page, its category trees, search filters, and virtual media grid props to re-evaluate and re-render.

Fixing this by moving the 1-second timer into the child now-playing progress display component isolates the high-frequency re-renders to only the active session cards.

## Current state

- `web/src/pages/Dashboard.jsx:742`:
```javascript
const [nowPlayingRenderNow, setNowPlayingRenderNow] = useState(() => Date.now());
```
- `web/src/pages/Dashboard.jsx:870-878`:
```javascript
  useEffect(() => {
    if (tier < 100 || nowPlaying.length === 0) return undefined;

    const tick = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      setNowPlayingRenderNow(Date.now());
    }, NOW_PLAYING_TICK_MS);

    return () => clearInterval(tick);
  }, [nowPlaying.length, tier]);
```
- Consumed only in `web/src/pages/Dashboard.jsx:1143` to calculate elapsed progress percentages on now-playing cards.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `npm run test:web`       | exit 0, all pass    |
| Lint      | `npm run lint --workspace=web` | exit 0        |
| Build     | `npm run build`          | exit 0              |

## Scope

**In scope**:
- `web/src/pages/Dashboard.jsx`
- `web/src/components/dashboard/` or now-playing card component

**Out of scope**:
- Server playback session polling endpoints.

## Git workflow

- Branch: `advisor/007-isolate-now-playing-tick`
- Commit message: `perf(web): isolate 1-second now-playing interval to avoid dashboard re-renders`

## Steps

### Step 1: Encapsulate Timer in Now-Playing Card Component

1. Identify where `nowPlayingRenderNow` is passed down in `Dashboard.jsx`.
2. Extract the progress calculation or timer into a dedicated `NowPlayingCard` or `NowPlayingProgress` component.
3. In that child component, maintain local tick state updating every second during active playback.
4. Remove `nowPlayingRenderNow` state and its top-level `setInterval` effect from `Dashboard.jsx`.

### Step 2: Verify Web Tests and Build

Run `npm run test:web` and `npm run build`.

## Done criteria

- [ ] `npm run lint --workspace=web` exits 0.
- [ ] `npm run test:web` exits 0.
- [ ] `npm run build` succeeds.
- [ ] Root `Dashboard` does not re-render every 1 second during active playback.

## STOP conditions

- If `nowPlayingRenderNow` is consumed by non-card elements in `Dashboard.jsx`, report before removing.
