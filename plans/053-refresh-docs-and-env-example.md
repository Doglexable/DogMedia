# Plan 053: Refresh stale docs and complete .env.example

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- README.md AGENTS.md PROJECT_CONTEXT.md .env.example web/README.md desktop/README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `2bf8caa`, 2026-10-06

## Why this matters

The root README tells operators to install a GTK4/libadwaita toolchain the
build never uses, states a resume TTL wrong by 672x, and `.env.example` omits
the Redis password Compose requires — each costs a new operator a debug
cycle. `PROJECT_CONTEXT.md` and `AGENTS.md` (the files agents bootstrap from)
undercount the suite 10x and misstate ports. Stale docs are worse than
missing. After this plan, all five files match verified code.

## Current state

Facts verified 2026-10-06 (re-verify each before editing):

1. `README.md:13` stack table: `Desktop client | Rust + GTK4/libadwaita + GStreamer`;
   `README.md:194-228` GTK install/build instructions. Reality:
   `desktop/Cargo.toml:14-22` (`dioxus-native =0.7.10`, `wgpu`, `winit`, zero
   GTK/libadwaita deps); `desktop/README.md:1-8` ("Dioxus Native, Blitz/WGPU,
   and GStreamer … not an Electron/Tauri wrapper"); real reqs at
   `desktop/README.md:9-48` (Rust 1.88+, Vulkan/Mesa drivers).
2. `README.md:479` Redis table: `playback:resume:<ip>:<mediaId>` TTL "7 days".
   Reality: `server/src/routes/playback.js:24-26` defaults to `900` (15 min);
   `compose.yml` sets no override. `AGENTS.md:98` (15m) is correct.
3. `.env.example:1-54` has no `PFS_REDIS_PASSWORD`, yet `compose.yml:21,47,76`
   require it (`--requirepass`, `REDIS_URL` interpolation). Also absent despite
   live `process.env` reads: `DATA_DIR`/`UPLOAD_TMP_DIR`
   (`server/src/index.js:35-36`), `PLAYBACK_RESUME_TTL_SECONDS`
   (`server/src/routes/playback.js:24-26`), `HOST`/`TRUST_PROXY`, `SLOW_QUERY_MS`/
   `SLOW_REQUEST_MS`, `RUN_CLEANUP_IN_SERVER`, `MUSIC_REEL_*_FONT_PATH`,
   `ENCODING_*_CLAIM_IDLE_MS`, `MEDIA_CLEANUP_*`, `EXPO_PUBLIC_API_URL`.
4. `PROJECT_CONTEXT.md:173-190` claims tests are only "lyrics normalization,
   auth IP resolution, Wrapped lock helpers" + "lyrics active-line" + "offline
   sync, player hooks", and lint "prints empty-config warnings". Reality
   (executed 2026-10-06): server 30 files/281 tests, web 40/307, mobile
   14/138; `npm run lint` exits 0 with zero warnings.
5. `AGENTS.md:12-28` layout omits `desktop/`, `mobile/`, `plans/`, `scripts/`;
   `:20` says web image `nginx:alpine` vs `web/Containerfile:19`
   (`nginx:stable-alpine`); `:67` says "CSS Modules or Tailwind (pick one)"
   though `web/README.md:3-7` records Tailwind v4 decided; `:99` says dev Redis
   `localhost:6379` while compose/dev default to `127.0.0.1:16379`.

Hard rule: NEVER paste real secret values — `.env.example` additions use
empty/placeholder values with code defaults in comments only.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Verify counts | `npm run test:server 2>&1 \| tail -3; npm run test:web 2>&1 \| tail -3; npm run test:mobile 2>&1 \| tail -3` | record current numbers |
| Lint | `npm run lint` | exit 0 |
| Grep stale claims | `grep -rn "7 days" README.md; grep -rn "GTK" README.md` | no matches after fix |

## Scope

**In scope** (docs only):

- `README.md` (desktop section + stack row + resume TTL cell)
- `.env.example` (missing vars with placeholder values + default comments)
- `PROJECT_CONTEXT.md` (testing notes + lint claim)
- `AGENTS.md` (layout, image tag, styling decision, Redis ports, dev command)

**Out of scope**:

- Any source-code, config, or behavior change. Docs only.
- `desktop/README.md`, `web/README.md`, `mobile/README.md` (sources of truth —
  read, don't edit).
- Restructuring docs beyond the listed fixes.

## Git workflow

- Branch: `advisor/053-docs-env-refresh`
- Conventional commits, e.g. `docs: refresh desktop section, TTL, env example and context docs`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Rewrite the README desktop section and fix the TTL cell

1. Replace `README.md:194-228` GTK instructions with a 5-line Dioxus/Blitz
   summary (Rust 1.88+, Vulkan/Mesa, `npm run build:desktop`, packaging
   outputs) + pointer to `desktop/README.md` for prerequisites. Fix the
   `README.md:13` table row to Dioxus Native/Blitz/WGPU.
2. Change `README.md:479` TTL cell to `15 min (900s, via PLAYBACK_RESUME_TTL_SECONDS)`.
3. Grep for other stale claims: `grep -rn "GStreamer\|libadwaita\|7 days" README.md`
   and fix or confirm each.

**Verify**: the two greps return no stale matches; render or eyeball the section.

### Step 2: Complete .env.example

Append documented-but-empty entries for every var in Current-state item 3,
each with its code default in a comment (read each default from source before
writing the comment — do not guess). `PFS_REDIS_PASSWORD=` stays empty with a
comment noting compose default `pfs_redis_secret` is dev-only. No real secrets.

**Verify**: `diff <(grep -oE '^[A-Z_]+=' .env.example)` covers every var name
from item 3; `npm run lint` unaffected (docs only).

### Step 3: Refresh PROJECT_CONTEXT.md and AGENTS.md

1. `PROJECT_CONTEXT.md:173-190`: replace with per-workspace file/test counts
   from the verification commands + "lint exits clean" + the vitest commands.
2. `AGENTS.md`: update layout tree (add `desktop/`, `mobile/`, `plans/`,
   `scripts/`), image tag (`nginx:stable-alpine`), styling (Tailwind v4
   decided per `web/README.md`), Redis ports (`127.0.0.1:16379` compose /
   `localhost:6379` standalone default + `REDIS_URL`), dev-command note.

**Verify**: `npm run lint` exits 0; spot-check every edited claim against its
source file once more.

## Test plan

Docs-only: no new tests. Verification is the grep checks + `npm run lint`
clean + a self-review pass reading each edited hunk against its cited source.

## Done criteria

- [ ] `grep -rni "gtk\|libadwaita" README.md` returns no matches
- [ ] `grep -n "7 days" README.md` returns no matches
- [ ] Every var in item 3 appears in `.env.example` with placeholder + default comment
- [ ] `PROJECT_CONTEXT.md` test counts match measured runs; no "empty-config warnings" claim
- [ ] `npm run lint` exits 0
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any "Current state" fact no longer holds (e.g. desktop stack changed again —
  reconcile with reality, don't blindly apply).
- A default value in source can't be found — omit that var with a note rather
  than guessing.
- Temptation to change code/config "while here" — out of scope, stop.

## Maintenance notes

- README stack table and `desktop/README.md` reqs drift apart easily — when
  the desktop stack changes, update both in the same commit.
- `.env.example` needs a new entry for every new `process.env` read;
  reviewers should enforce this per-PR.
