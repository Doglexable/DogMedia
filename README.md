# DogMedia

Self-hosted multimedia streaming server for photos, video, and audio. Access is
controlled via an IP whitelist with access tiers — no user accounts, no login
page.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Fastify 5 (JavaScript, ESM) |
| Frontend | React 19 + Vite 8 + Tailwind CSS v4 |
| Database | PostgreSQL 17 |
| Cache / Queue | Redis 7 |
| Container | Podman + Compose |

## Quick start

```bash
# development (requires PostgreSQL on 5432 + Redis on 6379)
npm run migrate --workspace=server
npm run dev

# development (Podman, live reload)
PFS_DB_PASSWORD=your_secret podman-compose -f compose.yml -f compose.dev.yml up --build
# or: PFS_DB_PASSWORD=your_secret podman compose -f compose.yml -f compose.dev.yml up --build

# production (Podman)
PFS_DB_PASSWORD=your_secret podman-compose up --build -d
```

## Containerization

```bash
# start all services for production
PFS_DB_PASSWORD=your_secret podman-compose up --build -d

# start all services for development with live code reload
PFS_DB_PASSWORD=your_secret podman-compose -f compose.yml -f compose.dev.yml up --build
# or: PFS_DB_PASSWORD=your_secret podman compose -f compose.yml -f compose.dev.yml up --build

# rebuild a single service
podman-compose build web

# migrations inside container
podman exec pfs-server npm run migrate

# shell inside container
podman exec -it pfs-server sh
```

Services: `db` (postgres:17-alpine, host port 5440), `redis` (redis:7-alpine),
`server` (fastify), `web` (nginx:alpine, host port 8030 in production).
Persistent service data is bind-mounted under this repository's `data/` folder:
PostgreSQL in `data/postgres/`, Redis in `data/redis/`, media files in
`data/media/`, temporary uploads in `data/tmp/`, and nginx logs in
`data/nginx/`.

Server depends on db + redis health checks. Web proxies `/api/` to server.

For live development, `compose.dev.yml` overrides the app services:

- `server` bind-mounts `./server` into the container and runs
  `npm run dev --workspace=server`, so `node --watch` reloads Fastify on code
  changes.
- `web` bind-mounts `./web` into the container and runs Vite on
  `http://localhost:5173/`, so React changes hot-reload in the browser.
- `db`, `redis`, media files, and upload temp files still come from
  `compose.yml` bind mounts under `data/`, so local state is shared with the
  normal Podman setup.

## Architecture

```
┌────────┐   nginx proxy
│ Browser │ ────────────────────────────► 10.89.0.x:3001 (server container)
└────────┘                                    │
     │ X-Client-IP (WebRTC-discovered)         │
     │                                         ├─ auth onRequest hook
     │                                         │   ├─ CIDR lookup → tier + description
     │                                         │   ├─ 403 if not whitelisted
     │                                         │   ├─ first-run: auto-whitelist
     │                                         │   │   ├─ caller IP → tier 999 (Admin)
     │                                         │   │   ├─ host LAN IPs → tier 999 (Admin)
     │                                         │   │   └─ private subnets → tier 0 (Standard)
     │                                         │   └─ attach request.accessTier/Description
     │                                         │
     │                                         ├─ route handler (tier-gated)
     │                                         │   ├─ PostgreSQL (categories, media, whitelist)
     │                                         │   └─ Redis (queue, events, resume, now-playing)
     │                                         │
     │                                         └─ media stream (Range-aware)
```

### Podman rootless IP

Podman rootless (`slirp4netns`) NATs all container source IPs — `request.ip`
always shows the podman bridge address (`10.89.0.x`), not the real client.

The frontend discovers the real LAN IP via WebRTC (`getLocalIp`) and sends it
as the `X-Client-IP` header. The server reads this first, then falls back to
`X-Forwarded-For` → `request.ip`.

Chrome's mDNS obfuscation returns `.local` hostnames from WebRTC; `isValidIp()`
rejects anything that isn't a valid IPv4 dotted-quad, so those fall through to
`request.ip` (which still matches the blanket private subnets in the whitelist).

## IP Whitelist bootstrap

On the **first ever request**, the middleware detects an empty whitelist table
and auto-populates it with three tiers:

| CIDR / IP | Tier | Description |
|-----------|------|-------------|
| Caller's exact IP | 999 | First-run auto-add (Admin) |
| Host machine's LAN IPs | 999 | Host Machine LAN IP (Admin) |
| `192.168.0.0/16`, `10.0.0.0/8`, `172.16.0.0/12` | 0 | Home Network (Standard) |

This means the machine that initializes the server gets Admin (tier 999), and
any device on the local network can watch content (tier 0). Additional entries
can be added manually.

### Managing the whitelist

Whitelist management routes are restricted to localhost only. From the server
host:

```bash
# list
curl http://localhost:3001/api/whitelist

# add
curl -X POST http://localhost:3001/api/whitelist \
  -H 'Content-Type: application/json' \
  -d '{"cidr_range":"192.168.1.0/24","access_tier":50,"description":"Home LAN"}'

# delete
curl -X DELETE http://localhost:3001/api/whitelist/1
```

Note: `ORDER BY masklen(cidr_range) DESC LIMIT 1` ensures more specific CIDR
entries (e.g. `/32` for a single IP) take priority over broader ranges (`/16`).

## Fastify v5 encapsulation

Fastify 5 introduced strict encapsulation: hooks and decorations registered on
a parent are **not** inherited by routes created with `register` + `prefix`.

| Problem | Solution |
|---------|----------|
| `app.register(authPlugin)` → auth hooks isolated in child context | Call plugin function directly: `await authPlugin(instance)` inside the route group |
| `fastify.decorate("redis", ...)` → decoration not visible in route handlers | Module-level `new Redis(REDIS_URL)` fallback in `playback.js` |
| Nginx `proxy_pass` to container hostname cached at startup | Variable-based `proxy_pass` with `resolver` directive |

## Database

- **categories** — organize media into folders, each with a `min_access_tier`
- **media_assets** — files stored at `data/media/{category_id}/{media_id}.{ext}`;
  media list/detail responses include `category_name` and `category_path` for
  player folder labels
- **ip_whitelist** — CIDR ranges mapped to access tiers + description

## Redis

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `queue:<ip>` | List | — | Per-IP media queue (auto-filled from category) |
| `queue:index:<ip>` | String | — | Current position in queue |
| `playback:events` | Sorted set | — | Timestamped event log for Wrapped |
| `playback:active:<ip>` | String | 5 min | Active session for now-playing dashboard, including loop/shuffle state |
| `playback:resume:<ip>:<mediaId>` | String | 7 days | Last known position for continue-watching |

## API

| Route | Auth | Description |
|-------|------|-------------|
| `GET /api/check-access` | None | Returns `{ tier, description, firstRun, ip }` |
| `GET /api/categories` | Whitelist | Lists categories visible to your tier |
| `GET /api/media` | Whitelist | Lists media visible to your tier, including category folder metadata |
| `GET /api/media/:id/stream` | Whitelist | Streams file with Range support |
| `POST /api/media` | Tier ≥ 100 | Upload media file (multipart) |
| `PUT /api/media/:id` | Tier ≥ 100 | Update media metadata |
| `DELETE /api/media/:id` | Tier ≥ 100 | Delete media |
| `GET/POST/PUT/DELETE /api/categories/:id` | Tier ≥ 100 | CRUD categories |
| `GET/POST/DELETE /api/whitelist` | localhost | Manage whitelist entries |
| `POST /api/queue/auto/:categoryId` | Whitelist | Fill queue with category media |
| `POST /api/queue/next` | Whitelist | Advance queue, return next mediaId |
| `POST /api/queue/prev` | Whitelist | Go back, return prev mediaId |
| `POST /api/queue/select` | Whitelist | Jump queue index to a chosen mediaId |
| `POST /api/queue/items` | Whitelist | Append one accessible, unique media item |
| `PUT /api/queue/order` | Whitelist | Atomically reorder the current queue |
| `DELETE /api/queue/items/:mediaId` | Whitelist | Remove one queue item |
| `DELETE /api/queue` | Whitelist | Clear the current queue |
| `GET /api/likes` | Whitelist | List the current IP's liked music |
| `PUT /api/likes/:mediaId` | Whitelist | Like an accessible audio item |
| `DELETE /api/likes/:mediaId` | Whitelist | Remove an audio item from likes |
| `GET /api/likes/share` | Whitelist | Check whether secret-link sharing is enabled |
| `POST /api/likes/share` | Whitelist | Generate or rotate a titles-only secret link |
| `DELETE /api/likes/share` | Whitelist | Revoke the current secret link |
| `GET /api/public/liked-music/:token` | Public token | Read shared music titles only |
| `POST /api/playback/event` | Whitelist | Log play/pause/end/skip event and update active session |
| `POST /api/playback/active` | Whitelist | Update now-playing state without adding a Wrapped event |
| `GET /api/playback/active` | Whitelist | Return the caller's active playback session for hard-refresh restore |
| `GET /api/playback/resume/:mediaId` | Whitelist | Get saved resume position |
| `GET /api/playback/now-playing` | Tier ≥ 100 | Active sessions across server |
| `GET /api/playback/wrapped` | Tier ≥ 100 | Aggregated stats + timeline |

## Frontend

### Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | Dashboard | Browse category tree, media grid, global player, now-playing table |
| `/media/:id` | Player | Full-screen route for the global player |
| `/admin` | Admin | Upload media + create categories (tier ≥ 100) |
| `/wrapped` | Wrapped | Visual timeline and stats (tier ≥ 100) |
| (403) | AccessDenied | Static block page |

### Layouts

- **Dashboard** — Uses the same app-shell style as Admin: sticky navbar,
  summary toolbar, bordered content panels, tree-style category browser, media
  cards, and admin now-playing table.
- **Category Browser** — Shows one folder level at a time with breadcrumb
  navigation. Opening a folder reveals its children; the media grid filters to
  the selected category.
- **Global Player** — `web/src/components/GlobalPlayer.jsx` owns the single
  `<audio>`/`<video>` element and stays mounted across routes. Dashboard and
  `/media/:id` both control the same player, so playback survives navigation.
- **Mini Player** — Bottom bar prioritizes centered controls/progress, shows
  track info on the left, shows folder/category path under the title, and keeps
  queue access on the right. It uses Font Awesome icons.
- **Full Player** — `/media/:id` renders the same global player in a larger
  view with audio artwork, video/image stage, prev/next navigation, queue
  controls, and resume prompts.
- **Wrapped** — Has the same navbar pattern as the app shell and renders Daily
  Activity as an SVG chart: line/area for play time and bars for play count.
- **Admin page** — Upload form (category, title, description, file, duration)
  and category creation form. Multipart upload via `POST /api/media`.
- **Responsive Breakpoints** — `theme.css` defines font and player layout
  variables for desktop, ≤900px, and ≤640px. The bottom player switches layout
  on small screens instead of squeezing all controls into one row.

### Theming

**Tailwind CSS v4** with CSS custom properties for runtime light/dark switching.
The `@theme` block in `web/src/theme.css` maps design tokens to `var()` references:

| Tailwind class | CSS variable |
|----------------|-------------|
| `bg-surface` / `text-content` | `--bg` / `--text` |
| `bg-card` / `border-card-border` | `--card-bg` / `--card-border` |
| `bg-primary` / `text-primary` | `--primary` |
| `text-muted` | `--muted` |
| `bg-modal-bg` / `text-modal-text` | `--modal-\*` |
| `bg-warning-\*` / `bg-success-\*` | `--warning-\*` / `--success-\*` |

Theme mode is controlled from each page navbar. The button cycles:

```text
System → Light → Dark → System
```

The selected mode is persisted to `localStorage("theme")` as `system`, `light`,
or `dark`. In `system` mode, the app follows `prefers-color-scheme` and updates
when the OS theme changes. An inline `<script>` in `index.html` resolves the
theme before paint — zero FOUC.

## Queue behaviour

- Clicking a media item inside a selected category auto-fills a per-IP queue
  with all media in that category and starts playback
- **Next/Prev** buttons navigate within the queue
- The queue panel lists queued media and lets the user jump to an item; the
  server-side Redis queue index is kept in sync via `POST /api/queue/select`
- Shuffle chooses a random next item from the current queue
- Loop mode cycles through `none`, `queue`, and `media`
- `loop queue` wraps next/prev around queue boundaries and restarts the queue
  after the final item
- `loop media` repeats the current media item
- Events fire on play, pause, end, or skip

## Playback state and hard refresh

The browser continuously updates Redis-backed active playback state:

- `POST /api/playback/event` persists meaningful playback events for Wrapped
  and updates `playback:active:<ip>`
- `POST /api/playback/active` refreshes now-playing position/state without
  inflating Wrapped play counts
- active state includes media id, title, position, duration, action,
  `loopMode`, and `shuffleEnabled`
- Admin now-playing displays active sessions plus shuffle/loop badges
- after a hard refresh, the frontend calls `GET /api/playback/active` and
  restores the player at the last active media/position, but keeps it paused
  until the user presses play

## Implementation summary

This iteration changed the app from page-scoped playback to an app-wide media
experience:

- moved playback into a global React provider/component
- added queue list, queue item selection, shuffle, and loop modes
- made next/prev/end events update now-playing state
- restored active media after hard refresh without autoplay
- changed dashboard categories from flat pills to a level-by-level folder tree
- restyled Dashboard and Wrapped to match the Admin app shell
- replaced player symbols with Font Awesome icons
- added responsive font and player breakpoints for small screens
- updated Wrapped Daily Activity from a simple bar strip to an SVG chart

## Commands

```bash
npm run dev              # server + web (concurrent)
npm run dev:server       # server only
npm run dev:web          # web / vite only
npm run migrate          # run DB migrations
npm run build            # Vite production build
npm run lint             # ESLint
npm run test             # Vitest (all)
npm run test:server      # server tests
npm run test:web         # web tests
```

## Security notes

- Media files stored under `data/media/` (gitignored, bind-mounted by Podman)
- All media access requires IP whitelist check + tier validation
- Streaming uses `Range` headers for seeking — no pre-signed URLs
- Whitelist management is restricted to localhost only
- First-run auto-bootstraps the whitelist: caller + host IPs get Admin,
  common private subnets get Standard access
- CIDR matching prefers specific entries over broader ones (`ORDER BY masklen`)
- Podman rootless bridge → no real client IP at network layer; WebRTC
  `X-Client-IP` header used as best-effort workaround
