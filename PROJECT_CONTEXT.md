# DogMedia Project Context

## Purpose

DogMedia is a self-hosted private media streaming app for photos, video, and audio. Access is IP-based, with no user accounts or login page. The same client IP drives access tier checks, per-IP queues, favorites, resume state, active playback sessions, and Wrapped reporting.

## Stack And Runtime

- Backend: Fastify 5, JavaScript ESM, entrypoint `server/src/index.js`.
- Frontend: React 19, Vite, JavaScript, entrypoint `web/src/main.jsx`.
- Mobile: React Native 0.86, Expo 57, entrypoint `mobile/index.js`.
- Database: PostgreSQL via `@fastify/postgres`.
- Cache/queue: Redis via `ioredis`.
- Containers: Podman Compose with `db`, `redis`, `server`, `worker`, and `web`.
- Static/proxy: Nginx serves the built frontend and proxies `/api/` to Fastify.

Important commands:

```bash
npm run dev
npm run dev:server
npm run dev:web
npm run dev:mobile
npm run migrate --workspace=server
npm run test
npm run test:mobile
npm run lint
```

## App Shell And Navigation

Top-level frontend routing lives in `web/src/App.jsx`.

- `/` renders `Dashboard`.
- `/media/:id` renders the full player page.
- `/wrapped` renders Wrapped analytics.
- `/admin` renders admin tools.
- `/shared/likes/:token` renders public shared favorites and bypasses the protected app shell.

`AccessGuard` calls `/api/check-access` before protected routes render. If access fails, it shows `AccessDenied`. If access succeeds, the app renders `LibraryShell`, which owns global sidebar state and category loading.

`LibraryShell`:

- Loads categories from `/api/categories`.
- Renders desktop sidebar and mobile bottom nav.
- Shows `All media`, `Favorites`, `Wrapped` when available, and `Admin` for tier `>= 100`.
- Checks `/api/wrapped/access` without consuming Wrapped access. If Wrapped is locked for the current IP, the Wrapped nav item is hidden unless the user is currently on `/wrapped`.

## Main UI Flow

### Dashboard

`web/src/pages/Dashboard.jsx` is the primary media browsing surface.

- Reads `view=liked` and `category=<id>` from query params.
- Loads all/category media from `/api/media`, or favorites from `/api/likes`.
- Uses `/api/playback/dashboard` to build featured media, quick access, and content rows.
- Provides search across title, artists, description, category, and MIME type.
- Admin users see a Now Playing section from `/api/playback/now-playing`.

Media cards support:

- Click to play.
- Context menu actions: `Play next`, `Add to queue`, and for audio, `Add to favorites` or `Remove from favorites`.
- Favorite state comes from `useGlobalPlayer().isLiked`.
- Favorite updates use `useGlobalPlayer().toggleLike`, which calls `/api/likes/:mediaId`.

### Player

Global playback state lives in `web/src/components/GlobalPlayer.jsx`.

- Owns current media, queue IDs/items, hidden queue items, playback position, duration, pause state, volume/mute, loop mode, shuffle, active session restore, resume positions, and liked IDs.
- Provides `playMedia`, `playNext`, `addToQueue`, `removeFromQueue`, `clearQueue`, `toggleLike`, and queue navigation through context.
- Persists active playback to `/api/playback/active`.
- Persists resume positions to `/api/playback/resume/:mediaId`.
- Sends playback events for reporting and stats.

The player UI is split into smaller components under `web/src/components/global-player/`, including mini/full player, queue panel, controls, lyrics panel, album art, and progress.

### Favorites

Favorites are per client IP and audio-only.

- `GET /api/likes` returns accessible liked audio.
- `PUT /api/likes/:mediaId` likes an accessible audio item.
- `DELETE /api/likes/:mediaId` removes it.
- `GET/POST/DELETE /api/likes/share` manages a secret public share token.
- `/shared/likes/:token` shows shared liked music through `SharedLikedMusic`.

### Wrapped

Wrapped is a per-IP playback report rendered by `web/src/pages/Wrapped.jsx`.

- The page requests `/api/wrapped/current?from=<iso>&to=<iso>` using a rolling 30-day display window.
- The first successful open consumes a rolling 30-day access window for the current IP.
- If the IP opens Wrapped again before `next_open_at`, the backend returns `429` with `code: "WRAPPED_LOCKED"`.
- The frontend renders a locked state with the next open date and approximate days remaining.
- After successful or locked Wrapped access, `Wrapped.jsx` dispatches `wrapped-access-changed`; `LibraryShell` listens and refreshes `/api/wrapped/access` so the sidebar/mobile nav can hide Wrapped immediately.

Backend Wrapped routes:

- `GET /api/wrapped/access`: non-consuming lock status for navigation.
- `GET /api/wrapped/current`: consumes access when allowed and returns current IP report.
- Admin-only CRUD routes under `/api/wrapped` manage saved wrapped reports.

Wrapped lock storage:

- Migration `server/src/migrations/009_wrapped_access_locks.sql`.
- Table `wrapped_access_locks(client_ip, last_opened_at, next_open_at, updated_at)`.
- Lock acquisition is atomic via `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE next_open_at <= NOW()`.

## Backend Route Map

Routes are registered in `server/src/index.js` under `/api`.

- `/api/check-access`: returns current access tier, description, first-run flag, and resolved client IP.
- `/api/categories`: category tree/list management.
- `/api/media`: media list, detail, thumbnails, streaming, and upload/admin actions.
- `/api/queue`: per-IP playback queue.
- `/api/playback`: playback events, active sessions, resume positions, dashboard stats, Wrapped source data.
- `/api/likes`: per-IP audio favorites and share token management.
- `/api/public`: public shared favorites.
- `/api/lyrics`: lyrics retrieval/update.
- `/api/whitelist`: admin/local whitelist management.
- `/api/wrapped`: current report, access lock status, and admin saved-report CRUD.

## Data And Persistence

PostgreSQL migrations live in `server/src/migrations/`.

Core tables include:

- `categories`: hierarchical folders with access tier requirements.
- `media_assets`: uploaded media metadata and file location.
- `ip_whitelist`: CIDR-based access tier rules.
- `playback_events`: persisted playback events used by stats and Wrapped.
- `liked_music`: per-IP favorites.
- `liked_music_shares`: public share tokens for favorites.
- `wrapped_reports`, `wrapped_top_media`, `wrapped_timeline_days`: admin-managed saved reports.
- `wrapped_access_locks`: rolling 30-day Wrapped access lock per IP.

Redis is used for:

- Per-IP media queue.
- Playback events fallback/history.
- Active session TTL.
- Resume position TTL.

Local media lives under `data/media/`; runtime data under `data/` is gitignored.

## Access And IP Model

Authentication is IP whitelist based, implemented by `server/src/plugins/auth.js`.

- First ever request bootstraps whitelist entries.
- `request.clientIp || request.ip` is the canonical owner identity for per-IP features.
- Reverse proxy correctness matters: Apache/Nginx/Fastify must preserve a trusted real client IP.

Access tiers:

- Standard users can browse/play media allowed by category tier.
- Tier `>= 100` unlocks admin navigation and admin routes.
- First-run bootstrap can assign high-tier admin access.

## UI Design Notes

- The app is an operational media library, not a marketing site.
- Main screens should prioritize browsing, playback, and quick actions.
- UI uses a persistent shell with sidebar on desktop/tablet and bottom nav on mobile.
- Cards are compact media objects; repeated actions belong in context menus or icon buttons.
- Keep text inside compact UI tight and avoid explanatory in-app copy unless it helps a real workflow.

## Testing Notes

Current tests:

- Server: lyrics normalization, auth IP resolution, Wrapped access lock helpers.
- Web: lyrics active-line helper.
- Mobile: offline sync, player hooks and components.

Useful verification after changes:

```bash
npm run test:server
npm run test:web
npm run test:mobile
npm run lint
```

`npm run lint` currently exits cleanly but prints existing ESLint empty-config warnings for server and web.

## Recent Implementation State

Recent uncommitted work includes:

- Wrapped rolling 30-day per-IP lock.
- Non-consuming Wrapped access status endpoint for navigation.
- Sidebar/mobile nav hiding Wrapped once seen and locked.
- Wrapped locked page state.
- Audio favorite add/remove action in media context menus.
- Server tests for Wrapped lock/status behavior.

When continuing from this context, avoid reverting these changes unless explicitly requested.
