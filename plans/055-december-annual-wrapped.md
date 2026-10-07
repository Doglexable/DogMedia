# Plan 055: Ship the December annual Wrapped experience

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/src/routes/wrapped.js web/src/pages/Wrapped.jsx mobile/src/screens/wrapped-screen.jsx PLAN_YEARLY_WRAPPED.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. ALSO read `PLAN_YEARLY_WRAPPED.md`
> fully first — it is the decided spec (quoted below in abbreviated form).

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/051-batch-wrapped-child-inserts.md (lands first — the
  annual timeline is ~12x longer, and batching makes its saves constant-trip;
  if 051 hasn't landed, you may still implement behind it but must re-run
  051's Done criteria after)
- **Category**: direction
- **Planned at**: commit `2bf8caa`, 2026-10-06
- **Execution status**: DONE — annual December flow and client copy are
  present and verified.

## Why this matters

The annual recap is the shareable, retention-driving moment for a household
media server, and the spec, tests, and copy are already written in
`PLAN_YEARLY_WRAPPED.md` — zero code exists. January–November behavior stays
identical; December gains an annual report (Dec 15 → Dec 15) with its own lock
copy. This is the cheapest stated-but-undelivered delight in the repo.

## Current state

Decided spec (`PLAN_YEARLY_WRAPPED.md`, read the full file — key quotes):

- "Keep the existing monthly Wrapped flow for January through November.
  During all of December, disable monthly Wrapped and show the annual Wrapped
  experience instead; annual Wrapped opens only on December 15."
- Server: "December 1-14: locked, next open is December 15 of the same year.
  December 15: annual Wrapped is available. December 16-31: locked, next open
  is December 15 of the next year. … skip monthly lock acquisition entirely
  and return annual availability/lock data. … return a one-year report period:
  previous December 15 through current December 15. Include a response
  mode/kind such as `wrappedKind: 'annual'` or `period.kind: 'annual-year'`…
  Keep monthly responses as `period.kind: 'rolling-30-day'`."
- Web `Wrapped.jsx`: monthly vs annual labels ("30-day recap" / "1-year
  recap"), December lock copy "Annual Wrapped opens December 15", plus story
  center-button redesign (compact icon-led controls, stable fixed heights —
  read the spec's exact requirements).
- Mobile `wrapped-screen.jsx`: mirror server-driven copy; December lock shows
  Dec-15 wording.
- "The old `wrapped_access_locks` table stays for monthly Wrapped and does
  not need a migration."
- Assumptions: December = server UTC; annual openable multiple times on Dec 15.

Existing code (verify before editing):

- Monthly rolling 30-day per-IP lock: `server/src/migrations/009_wrapped_access_locks.sql`,
  `INSERT ... ON CONFLICT ... WHERE next_open_at <= NOW()`; routes
  `GET /api/wrapped/access` (non-consuming) and `GET /api/wrapped/current`
  (consuming, 429 `WRAPPED_LOCKED`); see `PROJECT_CONTEXT.md:90-111`.
- Clients: `web/src/pages/Wrapped.jsx`, `mobile/src/screens/wrapped-screen.jsx`
  (monthly copy only).

Repo conventions: UTC date helpers on the server; `period` response object;
vitest suites per workspace; `npm run lint` clean.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Server tests | `npm run test:server` | all pass |
| Web tests | `npm run test:web` | all pass |
| Mobile tests | `npm run test:mobile` | all pass |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope**:

- `server/src/routes/wrapped.js` (December gating + annual period + kind
  discriminator; tests alongside)
- `web/src/pages/Wrapped.jsx` (annual/monthly copy split + center-button
  redesign per spec)
- `mobile/src/screens/wrapped-screen.jsx` (annual/monthly copy split)
- Shared Wrapped story utilities (only as the spec requires for annual timelines)
- Corresponding `*.test.js(x)` files

**Out of scope**:

- Any database migration (spec says none needed — do not add one).
- Changing January–November monthly behavior, lock rules, or response shapes.
- Export format/dimensions changes (filenames/dimensions stay unchanged per spec).
- Anything outside Wrapped (player, queue, desktop).

## Git workflow

- Branch: `advisor/055-annual-wrapped`
- Conventional commits, e.g. `feat(wrapped): add December annual Wrapped experience`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Server December gating + annual period (with tests)

1. Add UTC date helpers (December detection, Dec-15 boundaries) in
   `wrapped.js` per spec.
2. In the access/current handlers: if server-UTC month is December, skip
   monthly lock acquisition entirely; Dec 1–14 → locked with next-open
   Dec 15 same year; Dec 15 → one-year report (prev Dec 15 → current Dec 15)
   with `period.kind: "annual-year"` (or `wrappedKind: "annual"` — pick the
   shape the spec's test section implies and use it consistently);
   Dec 16–31 → locked, next open Dec 15 next year. Non-December: byte-identical
   current behavior with `period.kind: "rolling-30-day"`.
3. Tests (from the spec): monthly works Jan–Nov with existing lock rules;
   skipped in December; Dec 14 → `WRAPPED_LOCKED` next-open Dec 15; Dec 15 →
   annual data with one-year period; Dec 16 → locked next-open next year.
   (Use date mocking consistent with existing wrapped tests — check how they
   control time first.)

**Verify**: `npm run test:server` → all pass including new December tests.

### Step 2: Web annual/monthly copy + button redesign

Per spec in `Wrapped.jsx`: server-driven kind selects labels ("30-day recap"
vs "1-year recap", "Your 30-day replay" vs "Your 1-year replay"); December
lock copy "Annual Wrapped opens December 15"; keep fullscreen story + export
behavior; redesign center action buttons (compact icon-led, stable fixed
heights, tighter padding, restrained glass; `Download slide` every slide,
`Download all` final slide only; preserve export status/error text).

**Verify**: `npm run test:web` → pass including new annual-label tests.

### Step 3: Mobile copy parity

Mirror in `wrapped-screen.jsx`: annual vs monthly copy from server kind;
December lock Dec-15 wording; monthly copy outside December.

**Verify**: `npm run test:mobile` → pass including new tests.

## Test plan

- Server December matrix (Step 1), web annual/monthly label + lock-copy tests,
  mobile copy tests; export filenames/dimensions unchanged assertions.
- All three suites green; lint clean.

## Done criteria

- [ ] `npm run test:server`, `test:web`, `test:mobile` all exit 0 with new
      annual-Wrapped tests passing
- [ ] December gating matches the spec's date matrix exactly (Dec 14 locked /
      Dec 15 annual one-year period / Dec 16 locked-next-year)
- [ ] Monthly Jan–Nov behavior unchanged (existing tests unmodified and green)
- [ ] No migration added; `wrapped_access_locks` untouched for monthly
- [ ] `npm run lint` exits 0
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `PLAN_YEARLY_WRAPPED.md` contradicts current wrapped code beyond the
  spec's description (e.g. lock mechanism replaced) — stop and report.
- Monthly behavior cannot be preserved byte-identical — stop and report.
- Any suite fails twice after reasonable attempts.

## Maintenance notes

- The December branch is date-dependent — the most likely future bug is
  timezone drift (spec fixes server UTC; keep it).
- If a second annual cadence is ever added, the kind discriminator
  (`annual-year` vs `rolling-30-day`) is the extension point.

## Execution notes (2026-10-06)

- The current tree already contains the complete implementation: server UTC
  December gating, annual period/kind metadata, web and mobile annual copy,
  annual timeline sizing, December lock copy, and the existing export controls.
- Focused tests passed: server 27, web 12, mobile 7. Full suites passed:
  server 304, web 310, mobile 138. Workspace lint passed.
- No migration was added and the monthly `wrapped_access_locks` path remains
  unchanged outside December.
