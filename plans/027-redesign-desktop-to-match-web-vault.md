# Plan 027: Redesign the Native Desktop Application to Match the Web Vault UI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: this plan was written against the working tree
> based on commit `2d60ba2`; the Dioxus migration was not committed at planning
> time. Run both commands:
>
> ```bash
> git diff --stat 2d60ba2..HEAD -- desktop/src desktop/assets desktop/tests desktop/README.md web/src/theme.css web/src/vault-theme.css web/src/pages/Dashboard.jsx web/src/components/library-shell.jsx web/src/components/dashboard web/src/components/global-player
> git diff --stat -- desktop/src desktop/assets desktop/tests desktop/README.md web/src/theme.css web/src/vault-theme.css web/src/pages/Dashboard.jsx web/src/components/library-shell.jsx web/src/components/dashboard web/src/components/global-player
> ```
>
> A non-empty second command is expected only while the current Dioxus/Blitz
> migration remains uncommitted. Before changing anything, compare the live
> code with the "Current state" excerpts below. If the desktop is no longer a
> Dioxus Native/Blitz client, or playback ownership moved out of
> `desktop/src/ui/mod.rs`, stop and re-plan.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: Plan 026's Dioxus Native client implementation (already present in the planning working tree)
- **Category**: direction
- **Planned at**: commit `2d60ba2`, 2026-10-01, plus the uncommitted Dioxus migration listed by the drift check
- **Implementation**: Code and automated gates complete on 2026-10-01; host
  Wayland/real-media visual acceptance remains because the execution sandbox
  cannot connect to the compositor.

## Why this matters

The native desktop application's browsing and playback functionality works on
the target laptop, including smooth 1080p24 video through the persistent WGPU
texture. Its interface is still a functional spike: a top bar, form controls,
two generic cards, and a large all-in-one player. The web application has a
much more deliberate Dogmedia identity: a restrained Scandinavian neutral
palette, rose playback signal, persistent library rail, artwork-led featured
area, dense media table, anchored player, immersive full-player stage, and
focused queue/settings surfaces.

This plan ports that visual language and information architecture to Dioxus
Native without embedding the React app and without disturbing the proven
GStreamer, Tokio, session, queue, or WGPU behavior. “Match” means the same
hierarchy, tokens, spacing, recognizable surfaces, terminology, and common
states; it does not mean implementing unrelated web-only product features or
copying browser-only CSS into Blitz.

## Product and visual contract

Use this direction throughout the implementation:

- **Concept**: “Dogmedia Vault” — an operational media library, not a landing
  page. The library should be easy to scan; artwork and the active player are
  the only expressive visual moments.
- **Palette**: paper `#f8f8f7`, ink `#0a0a0a`, white `#ffffff`, rose
  `#e11d48`; dark background `#0a0a0a`, dark card `#181818`, light text
  `#f5f5f4`. Use alpha-equivalent static colors where Blitz cannot parse modern
  CSS color syntax.
- **Typography**: Inter/system sans for UI, a system monospace stack for
  durations and compact metadata. Use weight, size, and spacing for hierarchy;
  do not add display fonts.
- **Shape**: 8px small controls, 12px cards, 18px featured/player artwork.
  Avoid excessive pills; reserve fully rounded shapes for compact filter chips,
  status dots, and the main play button.
- **Layout**: 264px fixed library rail, 72px header, main content capped near
  1320px, 24–36px content gutters, and a persistent player at the bottom when
  media is active.
- **Signature element**: cover-led media stage. The featured item and expanded
  player get large, crisp artwork/video; the rest of the UI remains quiet.
- **Motion**: 120–180ms hover/focus transitions and one restrained list-entry
  reveal at most. Honor reduced motion. No decorative spinning, glow fields,
  parallax, or continuous animation.

## Current state

### Native architecture that must survive the redesign

- `desktop/src/ui/mod.rs:38-60` owns one `NativeApp` state object containing
  settings, client, browsing filters, queue, `PlaybackCoordinator`, protected
  playback session, lyrics/subtitles, photo data, and UI status.
- `desktop/src/ui/mod.rs:132-194` keeps a Tokio runtime entered for the complete
  Dioxus event-loop lifetime, constructs `PlaybackEngine`, and registers one
  persistent `VideoPaintSource` with `use_wgpu`.
- `desktop/src/ui/views/shell.rs:22-48` currently renders a top bar, a two-column
  Library/Queue grid, the player card, and settings dialog.
- `desktop/src/ui/views/library.rs:10-79` currently renders search, media type,
  category, favorites, and rows inside one generic card.
- `desktop/src/ui/views/player_bar.rs:11-117` currently mixes video/photo
  rendering, transport, progress, favorite, quality, queue, volume, lyrics,
  and subtitles in one component.
- `desktop/src/ui/video_surface.rs` is the custom WGPU renderer. Its source ID,
  persistent texture, and frame upload lifecycle are a protected boundary.
- `desktop/vendor/wgpu_context` patches recoverable surface-acquisition
  timeouts. Do not replace or bypass it during a UI redesign.
- `desktop/assets/native.css` is only about 82 lines and uses a generic card
  layout. It is safe to replace deliberately after the compatibility spike.

Key state excerpt (`desktop/src/ui/mod.rs:38-60`):

```rust
pub(crate) struct NativeApp {
    store: SettingsStore,
    settings: Settings,
    client: Option<ApiClient>,
    library: AppState,
    categories: Vec<Category>,
    search: String,
    media_filter: MediaFilter,
    category_id: Option<CategoryId>,
    favorites_only: bool,
    queue: Option<QueueWindow>,
    coordinator: PlaybackCoordinator,
    session: Option<PlaybackSession>,
    lyrics: String,
    subtitles: Vec<SubtitleTrack>,
    selected_subtitle: Option<usize>,
    subtitle_cues: Vec<SubtitleCue>,
    photo_data_url: Option<String>,
    settings_open: bool,
    settings_url: String,
    allow_http: bool,
    status: Option<String>,
}
```

The video mount (`desktop/src/ui/views/player_bar.rs:34-43`) is currently:

```rust
if playback.media.as_ref().is_some_and(Media::is_video) {
    div { class: "video-stage",
        canvas { class: "video-surface", "src": "{video_source_id}" }
        if !active_subtitle.is_empty() {
            div { class: "subtitle-overlay", "{active_subtitle}" }
        }
    }
}
```

Preserve exactly one live WGPU canvas for active video. Moving this block to an
expanded player is allowed; mounting a second canvas, recreating the source ID,
or switching playback engines is not.

### Web interface that defines parity

- `web/src/vault-theme.css:7-38` defines the light tokens, Inter/system font
  stacks, radii, 264px sidebar, and 72px header.
- `web/src/vault-theme.css:40-62` defines the near-black dark theme and its
  white-alpha hierarchy.
- `web/src/components/library-shell.jsx:315-367` renders the brand, All Media,
  Favorites, categories, access indicator, theme control, and version in the
  persistent sidebar.
- `web/src/pages/Dashboard.jsx:592-683` renders search in the header, media type
  chips, loading/empty states, an optional featured panel, and the browse list.
- `web/src/pages/Dashboard.jsx:209-253` defines the featured panel: eyebrow,
  large title, category/duration, description, Play/Play next/Queue, and hero
  artwork.
- `web/src/vault-theme.css:254-283` gives the header and main-content geometry.
- `web/src/vault-theme.css:354-491` gives the featured card its two-column
  artwork-led hierarchy.
- `web/src/vault-theme.css:500-883` defines the dense media list, active rose
  state, hover actions, responsive columns, and reduced-motion behavior.
- `web/src/components/global-player/player-bar.jsx:41-126` uses a three-zone
  player: artwork/title, transport/progress, utilities.
- `web/src/theme.css:3702-4015` defines the immersive full-player stage and
  controls. Browser-only blur and `color-mix()` are references, not code to
  copy.
- `web/src/components/global-player/queue-panel.jsx:152-293` treats the queue as
  an on-demand panel with a pinned current item instead of a permanent library
  column.

The authoritative web tokens are:

```css
--vault-ink: #0a0a0a;
--vault-paper: #f8f8f7;
--vault-rose: #e11d48;
--card-bg: #ffffff;          /* dark: #181818 */
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 18px;
--global-sidebar-width: 264px;
--app-header-height: 72px;
```

### Data already available, and data needed for visual parity

- `Media` already includes `artwork_version`, category data, description,
  duration, mime type, and favorite status
  (`desktop/src/domain/media.rs:40-65`).
- The server already exposes `GET /api/media/:id/thumbnail`, falling back to a
  category cover (`server/src/routes/media.js:1388-1411`). No server change is
  needed.
- The web home uses `GET /api/playback/dashboard` to select `featuredId` and
  quick access IDs (`web/src/pages/Dashboard.jsx:450-469`). The endpoint also
  returns hydrated media rows (`server/src/routes/playback.js:467-480`).
- The native `Endpoint` enum has neither thumbnail nor dashboard variants
  (`desktop/src/api/endpoint.rs:12-52`). Add them through the typed client; do
  not issue ad-hoc `reqwest` calls from view components.
- `Category` currently omits its optional cover/artwork version, so category
  rail thumbnails cannot yet be cached consistently
  (`desktop/src/domain/category.rs:5-21`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Native dependency/source guard | `npm run check:desktop:native` | exit 0; no forbidden webview/browser dependency |
| Format | `cargo fmt --manifest-path desktop/Cargo.toml --check` | exit 0; no diff |
| Rust lint | `cargo clippy --manifest-path desktop/Cargo.toml --all-targets --all-features -- -D warnings` | exit 0; no warnings |
| Desktop tests | `npm run test:desktop` | all Rust tests pass |
| Native-only tests | `npm run test:desktop:native` | native UI library tests pass |
| Release build | `npm run build:desktop` | `desktop/target/release/dogmedia-desktop` is produced |
| Packaging guard | `npm run check:desktop:packaging` | package manifests/scripts validate |
| Web reference regression | `npm run test:web` | all web tests pass; reference UI was not changed |
| Working-tree scope | `git status --short` | only files listed under Scope plus `plans/README.md` are new/modified by this plan |

Do not use a debug build for video acceptance; prior measurements showed debug
frame upload below the 24fps source rate. Run the final real-video check with
the release binary.

## Suggested executor toolkit

- Use the `frontend-design` skill, if available, to evaluate hierarchy,
  typography, density, and responsive behavior before writing CSS.
- Treat `web/src/vault-theme.css` as the design reference and
  `desktop/assets/native.css` as the implementation target.
- Keep a small CSS compatibility log in
  `desktop/docs/web-ui-parity.md`; Dioxus Native/Blitz is beta and does not
  guarantee browser-complete CSS support.

## Scope

**In scope** (the only source files to modify or create):

- `desktop/src/api/endpoint.rs`
- `desktop/src/api/endpoints.rs`
- `desktop/src/domain/category.rs`
- `desktop/src/domain/media.rs` or a new `desktop/src/domain/dashboard.rs`, plus
  `desktop/src/domain/mod.rs`
- `desktop/src/ui/mod.rs`
- `desktop/src/ui/kit.rs`
- `desktop/src/ui/views/mod.rs`
- `desktop/src/ui/views/shell.rs`
- `desktop/src/ui/views/library.rs`
- `desktop/src/ui/views/player_bar.rs`
- `desktop/src/ui/views/queue_panel.rs`
- `desktop/src/ui/views/settings_dialog.rs`
- New focused view modules under `desktop/src/ui/views/`: `sidebar.rs`,
  `featured.rs`, `full_player.rs`, `artwork.rs` (use similarly narrow names if
  the live module split makes one unnecessary)
- `desktop/assets/native.css`
- `desktop/tests/api_contract.rs`
- `desktop/README.md`
- New `desktop/docs/web-ui-parity.md`
- `plans/README.md` status only after completion

**Reference-only; do not modify**:

- `web/src/theme.css`
- `web/src/vault-theme.css`
- `web/src/pages/Dashboard.jsx`
- `web/src/components/library-shell.jsx`
- `web/src/components/dashboard/`
- `web/src/components/global-player/`
- `server/src/routes/media.js`
- `server/src/routes/playback.js`

**Out of scope**:

- Any change to `PlaybackEngine`, `PlaybackCoordinator`, `VideoPaintSource`,
  protected session/heartbeat/release behavior, Tokio runtime ownership, or the
  vendored `wgpu_context` timeout patch.
- PostgreSQL, Redis, server routes, response shapes, access tiers, queue
  semantics, or playback reporting.
- Electron, Tauri, WebView, React reuse, a local HTTP UI, JavaScript, or copying
  the generated web bundle.
- Web-only admin tools, Wrapped, active-session dashboard, music reels/share
  dialogs, equalizer, sleep timer, service worker, footer, mobile bottom nav,
  and offline downloads.
- New queue semantics. The desktop may expose its existing shuffle, clear,
  select, add, play-next, and remove operations. Do not add drag reorder unless
  it is planned and tested separately.
- Packaging format/runtime changes, MPRIS work, or platform expansion.
- Reworking the brand/logo. Reuse an already-shipped Dogmedia icon if Blitz can
  render it; otherwise use the wordmark and a restrained letter mark.

## Git workflow

- Branch: `feat/desktop-web-ui-parity`
- Make one commit per phase so visual regressions can be bisected.
- Use Conventional Commits, for example
  `feat(desktop): add vault library shell` and
  `test(desktop): cover artwork and dashboard endpoints`.
- Do not commit `desktop/target/`, runtime settings, media, screenshots with
  private titles unless the operator explicitly approves them, or session/
  viewer identifiers.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Freeze a parity matrix and prove Blitz primitives

Create `desktop/docs/web-ui-parity.md` before rewriting components. Include a
table with these rows and explicit native outcomes:

| Web surface | Native outcome |
|---|---|
| persistent library sidebar | Match: brand, All Media, Favorites, category list, access/settings footer |
| dashboard header | Match: search field and connection/refresh affordance |
| media type pills | Match: All, Music, Video, Photos |
| featured panel | Match when dashboard summary and artwork are available; degrade to first visible item |
| media track list | Match hierarchy and density; retain Load more pagination |
| bottom player | Match the three-zone layout using existing controls only |
| full player | Match immersive art/video, metadata, progress, controls, lyrics/subtitles |
| queue | Match as an on-demand right panel; retain native queue operations |
| settings | Match visual language; keep native server/HTTP/theme fields |
| admin/Wrapped/share/EQ/sleep timer | Explicitly out of scope |

Add a short compatibility table for the exact primitives the redesign needs:
CSS custom properties, grid, fixed positioning, `aspect-ratio`, media queries,
`prefers-color-scheme`, `prefers-reduced-motion`, overflow scrolling, range
inputs, inline SVG, and image data URLs. Build the smallest temporary examples
inside `Shell`/`kit.rs`, test them in both Wayland and the Flatpak if practical,
then remove the probes. Do not rely on `backdrop-filter`, `color-mix()`, nested
CSS, `@apply`, viewport dynamic units, or browser JavaScript.

Decision gates:

1. If inline SVG works, add a small `Icon` component with only the icons used by
   this UI and accessible labels on buttons. If it does not, use compact text or
   Unicode fallbacks and record the limitation; do not add an icon-font stack.
2. If `@font-face` is demonstrably supported, a separately licensed Inter font
   asset may be proposed before adding it. Otherwise keep the existing system
   font feature and the `Inter, ui-sans-serif, system-ui` stack.
3. If CSS media queries are unreliable, implement one stable desktop layout
   with a documented 960px minimum rather than adding Rust window-size logic in
   this plan.

**Verify**:

```bash
npm run check:desktop:native
cargo fmt --manifest-path desktop/Cargo.toml --check
cargo test --manifest-path desktop/Cargo.toml --no-default-features --features native-ui --lib
```

All commands exit 0, `desktop/docs/web-ui-parity.md` contains the matrix and
compatibility results, and no temporary probe remains.

### Step 2: Add typed dashboard and artwork loading

Extend the existing typed API boundary:

1. Add `Endpoint::Dashboard { view, category, media_type }`,
   `Endpoint::MediaThumbnail(MediaId)`, and, only if the sidebar design uses
   covers, `Endpoint::CategoryThumbnail(CategoryId)`. Build query strings with
   `url::form_urlencoded`; do not interpolate unescaped search/filter values.
2. Add serde domain structs for the fields the native UI consumes:
   `featured_id`, `quick_access_ids`, and hydrated `media`. Use aliases or
   `rename_all` matching the server's camelCase response. Ignore additive fields.
3. Add `ApiClient::dashboard(...)` and thumbnail byte methods in
   `desktop/src/api/endpoints.rs`, reusing `ApiClient::bytes` and the existing
   `X-Client-Platform`/viewer headers.
4. Add optional category artwork metadata matching the actual `/api/categories`
   JSON. Confirm field names from a test fixture or live response before coding.
5. In `NativeApp`, maintain a bounded artwork cache keyed by media/category ID
   plus artwork version. Store `Ready(data URL)`, `Missing`, and `Loading`
   states so a 404 is not fetched every render. Cap decoded data (for example,
   96 entries) and evict least-recently-used entries outside the render path.
6. Load the dashboard summary whenever library view, category, or media type
   changes. Keep browse results authoritative for the list. If dashboard loading
   fails, silently use the first visible media as featured and keep browsing
   usable; only browsing/access failure should replace the library state.

Do not create playback sessions for thumbnails. Do not fetch every row's art at
once: eagerly request the featured/current-player art and lazily request only
visible sidebar/list items. Ensure an old async result cannot overwrite a newer
filter generation.

Add contract tests in `desktop/tests/api_contract.rs` for:

- dashboard query encoding and camelCase deserialization;
- dashboard responses with unknown additive fields;
- media thumbnail URL/header construction and byte return;
- thumbnail 404 mapping to a stable missing-art state;
- artwork-version cache-key invalidation (a unit test may live beside the cache).

**Verify**:

```bash
cargo test --manifest-path desktop/Cargo.toml --test api_contract
cargo test --manifest-path desktop/Cargo.toml --lib
cargo clippy --manifest-path desktop/Cargo.toml --all-targets --all-features -- -D warnings
```

All tests pass. Test request URLs are under `/api/playback/dashboard`,
`/api/media/:id/thumbnail`, and optionally `/api/categories/:id/thumbnail`;
none contain playback session credentials.

### Step 3: Build reusable native vault primitives and tokens

Refactor `desktop/src/ui/kit.rs` into a small, native-only UI kit rather than
putting repeated RSX in every view. Retain `Button`, `Input`, `Select`, and
`Skeleton`, and add only primitives used at least twice: `IconButton`,
`Artwork`, `StatusBadge`, `Progress`, `Notice`, and `DialogFrame`. Every icon
button must have a visible tooltip/title and an accessibility label supported
by Dioxus Native.

Rewrite `desktop/assets/native.css` around semantic tokens for both explicit
light/dark classes and system preference. Use concrete fallback values; do not
paste the web's 9,000+ lines or browser-only Tailwind output. Define at least:

- canvas, card, elevated surface, text, secondary text, tertiary text, border,
  hover, pressed, rose signal, danger, and focus ring;
- spacing steps 4/8/12/16/24/32/48;
- radii 8/12/18;
- rail 264px, header 72px, player 104px;
- tabular/monospace time metadata;
- 2px high-contrast focus outlines.

Use rose for active navigation, active playback, progress, favorite state, and
focus—not for every heading or button. Primary library Play actions should use
ink on paper and paper on dark, matching the featured web card; the circular
player Play button may use rose.

**Verify**:

```bash
rg -n "color-mix|backdrop-filter|@apply|dvh|javascript:" desktop/assets desktop/src/ui
cargo fmt --manifest-path desktop/Cargo.toml --check
npm run check:desktop:native
```

The `rg` command returns no matches; the remaining commands exit 0.

### Step 4: Replace the top-bar/card shell with the web library hierarchy

Split `Shell` into a fixed `Sidebar`, main workspace, persistent player, queue
overlay/panel, and settings overlay:

```text
.vault-shell
├── Sidebar (264px)
└── .vault-workspace
    ├── Header (72px search + status/refresh)
    ├── Library main (scrolling, max ~1320px)
    └── MiniPlayer (only while media is selected)
        ├── QueuePanel (on demand)
        └── SettingsDialog (on demand)
```

The sidebar must contain:

- existing Dogmedia branding in a 72px brand row;
- All Media and Favorites navigation;
- a scrollable Categories section, indented by the existing `depth` field;
- selected state tied to `favorites_only`/`category_id`, with a 2px rose rail;
- connection/access status, Settings, and app version in the footer.

Selecting any navigation item updates the existing filters and calls
`begin_browse`; it must not recreate the API client or player. Move the search
field to the 72px header and keep Enter-to-search. Keep Refresh reachable but
make it secondary. Replace the global persistent notice block with a compact,
dismissible status banner within main content; retain error text and retry
context.

At widths below the proven compatibility breakpoint, collapse the category
rail before removing essential player controls. If the Step 1 media-query test
failed, keep the fixed desktop layout and document the minimum width.

**Verify**:

```bash
cargo test --manifest-path desktop/Cargo.toml --lib
cargo fmt --manifest-path desktop/Cargo.toml --check
cargo clippy --manifest-path desktop/Cargo.toml --all-targets --all-features -- -D warnings
```

All commands exit 0. Manual smoke check: changing All Media/Favorites/category
updates the list while currently playing audio continues uninterrupted.

### Step 5: Rebuild browsing as featured media plus a dense track list

Refactor `Library` into three regions:

1. A media-type chip row: All, Music, Video, Photos. Use “Music” in visible copy
   while retaining the existing `MediaFilter::Audio` domain value.
2. A featured panel when search is empty. Select the dashboard `featured_id`,
   then fall back to the first visible item. Render eyebrow/type, large title,
   category path, duration, optional description, Play, Play next, Queue, and
   hero artwork/fallback. Never render a blank hero while artwork loads.
3. A dense list with header columns `#`, `Title`, `Folder`, `Added/Type`, and
   duration. If the native media object lacks a trustworthy added date, label
   that column `Type`; do not invent dates. Each 52–56px row exposes title,
   artist/category, folder/type, duration, active rose state, favorite action
   for audio, and an overflow/action affordance for existing Play next/Queue.

Keep cursor pagination and `Load more`; do not attempt browser-style DOM
virtualization in Blitz without profiling evidence. Preserve differentiated
states:

- initial skeleton matching final row geometry;
- load-more indicator without clearing current rows;
- empty category/type;
- no search matches with Clear search action;
- artwork missing/error fallback by media type;
- active item, hover/focus item, and disabled/loading action.

The entire row may start playback, but nested favorite/queue actions must not
also trigger row playback. If Dioxus Native cannot stop event propagation
reliably, place actions outside the row button in the grid as the current queue
does.

**Verify**:

```bash
cargo test --manifest-path desktop/Cargo.toml --lib
npm run test:desktop:native
cargo clippy --manifest-path desktop/Cargo.toml --all-targets --all-features -- -D warnings
```

All commands exit 0. Manual smoke check covers search Enter, clearing search,
all four type chips, favorites, a nested category, favorite toggle, Play next,
Queue, Load more, and active-row updates.

### Step 6: Split the player into anchored and immersive surfaces

Keep one source of playback truth (`PlaybackCoordinator`) and split only the
presentation:

- `PlayerBar` becomes a 104px anchored three-zone bar: 56px artwork + title/
  subtitle; previous/play/next + progress/time; quality, favorite, volume,
  queue, and expand/close controls that already have native behavior.
- Add a boolean UI state such as `player_expanded` and a `FullPlayer` view.
  Expanding or collapsing must not call `play_media`, create a session, seek,
  pause, or reconstruct `PlaybackEngine`.
- For audio, full player shows large square artwork, metadata, progress,
  transport, utilities, and a lyrics column when lyrics exist.
- For video, mount the single `canvas` using the existing `video_source_id` in
  the full-player media stage, keep its 16:9 aspect ratio, black backing, and
  subtitle overlay. When collapsed, show a thumbnail in the mini-player rather
  than a second live video canvas.
- For photos, show the existing protected `photo_data_url` using contain
  fitting, metadata, favorite/queue actions as applicable, and a close control.
- Move subtitle selection into the full-player utility region. Convert lyrics
  from a raw `<pre>` under the player to a scrollable panel. Do not implement
  synchronized lyrics in this plan; retain existing text/cue semantics.

The close/stop affordance must remain distinct: collapse hides the expanded
view but keeps playback; Stop ends playback and releases the protected session
through the existing path.

Add pure helper tests for player presentation state where practical (for
example, which stage is selected for audio/video/photo and whether a mini-player
is visible). Do not add a second mocked playback engine solely for CSS tests.

**Verify**:

```bash
cargo test --manifest-path desktop/Cargo.toml
npm run check:desktop:native
npm run build:desktop
```

All commands exit 0. In the release binary, expanding/collapsing during active
audio and video does not restart position, create a second session, or produce
WGPU validation errors.

### Step 7: Convert queue and settings into focused overlays

Change `QueuePanel` from a permanent library column to an on-demand right-side
panel anchored above the mini-player. Show title/count, pinned current item,
upcoming items, per-row select/remove, Shuffle, Clear, close, loading, empty,
and error states. Keep the existing API mutations and refresh behavior. Do not
add drag/drop.

Restyle `SettingsDialog` with the same dialog frame, typography, input, focus,
and button tokens. Keep only the native settings it actually owns: server URL,
plain-HTTP trust, appearance, Save and connect, and Cancel when configured.
Opening settings or queue must not stop playback. Escape should close the top
overlay if Blitz delivers keyboard events consistently; otherwise expose an
obvious labeled close button and record the limitation.

Define an overlay priority rule in code and in `web-ui-parity.md`: settings is
modal and closes/blocks queue; queue is non-modal; full player may contain or
open the queue but must not place it behind the WGPU canvas.

**Verify**:

```bash
cargo test --manifest-path desktop/Cargo.toml
cargo clippy --manifest-path desktop/Cargo.toml --all-targets --all-features -- -D warnings
```

Both commands exit 0. Manual smoke check confirms select/remove/shuffle/clear,
settings cancel/save/reconnect, and continued playback while panels open.

### Step 8: Complete responsive, accessibility, performance, and visual acceptance

Audit every state in light, dark, and system themes. Provide visible keyboard
focus, descriptive labels/titles for icon controls, adequate contrast, and a
reduced-motion path. Ensure duration/progress values use tabular figures and
long titles/categories truncate without expanding the rail or player.

Performance boundaries:

- artwork cache remains bounded and does not refetch known 404s;
- library re-renders do not recreate data URLs for unchanged artwork;
- only one video canvas and one frame receiver exist;
- queue/settings toggles do not trigger API browse requests;
- idle library scrolling does not increase playback-session requests;
- release video remains visually smooth at the 1080p24 acceptance source.

Update `desktop/README.md` with one “Interface” section describing the library
rail, featured/list browsing, mini/full player, queue, settings, theme behavior,
and the documented minimum window width. Do not describe deferred web features
as implemented.

Run this manual matrix against a real server. Use non-private test media in any
captured artifacts:

| State | Required checks |
|---|---|
| connecting/offline/access denied | readable status, settings/retry reachable |
| empty/loading/search-empty | stable geometry and clear next action |
| All/Favorites/category | active rail state, correct heading and items |
| light/dark/system | token parity and contrast |
| audio media | artwork, mini player, full player, lyrics, favorite, queue |
| video media | one WGPU canvas, subtitles, expand/collapse, smooth 1080p24 |
| photo media | contain fit, no audio-only controls |
| queue/settings | correct stacking and playback continuity |
| narrow desktop window | no inaccessible primary controls |

**Verify**:

```bash
cargo fmt --manifest-path desktop/Cargo.toml --check
cargo clippy --manifest-path desktop/Cargo.toml --all-targets --all-features -- -D warnings
npm run test:desktop
npm run test:desktop:native
npm run check:desktop:native
npm run check:desktop:packaging
npm run test:web
npm run build:desktop
RUST_LOG=info ./desktop/target/release/dogmedia-desktop
```

All automated commands exit 0. The release run completes the manual matrix
without a panic, WGPU validation error, surface-timeout panic, playback restart
on UI toggles, or visibly sub-source-rate video on the previously validated
1080p24 media.

## Test plan

Automated tests to add or extend:

- `desktop/tests/api_contract.rs`: dashboard query/response, thumbnail bytes,
  headers, 404 behavior, and no session leakage.
- Domain tests beside the new dashboard structs: camelCase fields, optional
  fields, and additive JSON compatibility.
- UI/cache unit tests beside `desktop/src/ui/mod.rs` or a small extracted state
  module: featured fallback selection, artwork cache key invalidation, bounded
  eviction, filter-to-dashboard query mapping, and player/overlay state rules.
- Existing `desktop/tests/playback_state.rs` must continue passing unchanged;
  it is the regression guard for playback behavior this redesign may not alter.
- Existing web tests must pass without modification because the web UI is the
  reference, not part of this implementation.

Manual tests are required because Blitz does not currently have an established
visual snapshot harness in this repository. Judge against the explicit token,
geometry, and state matrix in this plan—not subjective “looks close” approval.

## Done criteria

- [ ] The desktop has a persistent Dogmedia library rail, 72px search header,
  artwork-led featured area, dense media list, anchored mini-player, immersive
  full player, on-demand queue, and vault-styled settings dialog.
- [ ] Light, dark, and system themes use the same paper/ink/rose token family as
  `web/src/vault-theme.css`.
- [ ] Dashboard and artwork requests go through typed `ApiClient` endpoints and
  have passing contract/cache tests.
- [ ] Search, filters, pagination, favorites, queue actions, quality, seek,
  volume, lyrics, subtitles, photos, and protected playback still work.
- [ ] Exactly one WGPU video canvas/source is live; expand/collapse does not
  restart playback or create a new playback session.
- [ ] The real 1080p24 release playback acceptance remains smooth and logs no
  WGPU validation or surface-timeout panic.
- [ ] Loading, empty, no-results, offline, access-denied, missing-art, and error
  states are intentional and reachable.
- [ ] Keyboard focus and control labels are visible; reduced motion is honored
  where supported.
- [ ] The artwork cache is bounded and generation-safe.
- [ ] All commands in Step 8 pass.
- [ ] `git status --short` shows no plan-created changes outside Scope.
- [ ] Plan 027's row in `plans/README.md` is updated to `DONE` with any recorded
  Blitz limitations linked from `desktop/docs/web-ui-parity.md`.

## STOP conditions

Stop and report instead of improvising if:

- The live desktop is not the Dioxus Native/Blitz architecture described above,
  or the WGPU canvas/source lifecycle has moved materially.
- Matching the layout would require a browser engine, React bundle, JavaScript,
  or changes to the server response contract.
- Blitz cannot reliably render fixed positioning, grid, overflow scrolling, or
  a range input. Record the failing minimal probe and re-scope the design before
  implementation.
- The design requires mounting two WGPU canvases or rebuilding
  `VideoPaintSource` when the player expands/collapses.
- Thumbnail loading requires playback sessions, exposes session/viewer IDs in
  URLs/logs, or produces unbounded memory growth.
- Any UI action begins changing playback/session/queue semantics rather than
  calling the existing action functions.
- The release build regresses previously validated 1080p24 playback, produces a
  WGPU validation error, or reintroduces the Tokio “no reactor running” panic.
- An automated verification fails twice after one reasonable correction.
- Completion appears to require editing any out-of-scope file.

## Maintenance notes

- The web has a large legacy stylesheet plus the newer vault layer. The vault
  tokens and current rendered component hierarchy are authoritative; do not
  chase every old glass/gradient rule in `theme.css`.
- Keep native CSS intentionally small and semantic. If a new web feature is
  later added to desktop, first decide whether it belongs in the native product
  scope; visual parity does not automatically imply feature parity.
- Reviewers should scrutinize session continuity, canvas count, artwork cache
  bounds, async generation guards, overlay stacking above the WGPU surface, and
  Flatpak behavior more closely than pixel-level decoration.
- Automated screenshot testing, queue drag/reorder, synchronized lyrics, MPRIS,
  offline downloads, admin, Wrapped, sharing, equalizer, and sleep timer remain
  separate follow-ups.
