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

## Run the project

### Requirements

- Podman with a Compose provider (`podman compose` or `podman-compose`)
- Git
- At least one writable disk location for `data/`; video libraries can grow
  quickly
- Apache HTTP Server 2.4 when using the reverse-proxy setup below

The examples use `podman compose`. If the host only provides the standalone
Compose command, replace it with `podman-compose`.

### Production with Podman

```bash
git clone https://github.com/Doglexable/DogMedia.git
cd DogMedia

# Create the local configuration. This file is ignored by Git.
cp .env.example .env
chmod 600 .env
```

Edit `.env` and replace `PFS_DB_PASSWORD=pfs_secret` with a strong password.
The Compose file supplies its own container addresses for PostgreSQL and Redis,
so the development `DATABASE_URL` and `REDIS_URL` values in `.env` do not need
to be changed for this setup.

Build the images, start the backing services, apply the database migrations,
and then start the application:

```bash
podman compose build
podman compose up -d db redis
podman compose run --rm server npm run migrate --workspace=server
podman compose up -d server web

# Confirm that all four services are running.
podman compose ps

# Test Nginx and Fastify locally. The first request bootstraps the IP whitelist.
curl -i http://127.0.0.1:8030/api/check-access
```

The production UI listens on `http://127.0.0.1:8030` from the host. Use the
Apache setup below to publish it on ports 80/443. Fastify listens only on
`127.0.0.1:3001`; PostgreSQL and Redis use host ports `5440` and `16379`.

Useful lifecycle commands:

```bash
podman compose logs -f server web  # follow application logs
podman compose restart server web # restart application services
podman compose down               # stop containers; keep data
podman compose up --build -d      # rebuild and start after an update
podman compose exec server npm run migrate --workspace=server
```

Do not use `podman compose down -v` unless volume deletion is intentional.
Persistent data is bind-mounted under `data/`: PostgreSQL in `data/postgres/`,
Redis in `data/redis/`, media in `data/media/`, temporary uploads in
`data/tmp/`, and Nginx logs in `data/nginx/`.

### Development with live reload

The development override bind-mounts `server/` and `web/`, runs Fastify with
Node watch mode, and serves Vite on port 5173:

```bash
cp .env.example .env
# Set a strong PFS_DB_PASSWORD in .env before continuing.

podman compose -f compose.yml -f compose.dev.yml up --build
```

In a second terminal, apply migrations once the database is healthy:

```bash
podman compose -f compose.yml -f compose.dev.yml \
  exec server npm run migrate --workspace=server
```

Open `http://localhost:5173`. Database, Redis, media, and temporary-file state
is shared with the production Compose setup under `data/`.

For development without containers, install Node.js 22, PostgreSQL, and Redis;
run `npm ci`, update `.env` with reachable database/cache URLs, then run:

```bash
npm run migrate --workspace=server
npm run dev
```

## Architecture

```text
Browser → Apache :80/:443 → Nginx :8030 → Fastify :3001
                                      ├─ PostgreSQL :5440
                                      └─ Redis :16379
```

All application containers use host networking. Apache removes any
client-supplied `X-Forwarded-For` value and adds the address of its direct
client. Nginx accepts that header only when the connection comes from loopback,
then sends a single normalized address to Fastify. Fastify trusts forwarding
headers only from its local Nginx peer. Consequently, `request.ip` is suitable
for the whitelist, per-IP queues, likes, resume state, and playback reporting.

### Apache reverse proxy and real client IP

The bundled `web/nginx.conf` trusts `X-Forwarded-For` only from `127.0.0.1` or
`::1`. Apache must therefore run on the same host as the containers and proxy to
`127.0.0.1:8030`. Do not broaden the trusted proxy ranges unless another known
proxy is deliberately added to the request path.

On Debian or Ubuntu, enable the required modules:

```bash
sudo a2enmod proxy proxy_http headers ssl
```

Create `/etc/apache2/sites-available/dogmedia.conf`, replace
`media.example.com` and the certificate paths, and use this configuration:

```apache
<VirtualHost *:80>
    ServerName media.example.com
    Redirect permanent / https://media.example.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName media.example.com

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/media.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/media.example.com/privkey.pem

    ProxyRequests Off
    ProxyPreserveHost On
    ProxyAddHeaders On

    # Discard a value supplied by the internet client. mod_proxy_http adds a
    # fresh X-Forwarded-For value containing Apache's direct client address.
    RequestHeader unset X-Forwarded-For
    RequestHeader set X-Forwarded-Proto "https"

    ProxyPass        / http://127.0.0.1:8030/ connectiontimeout=5 timeout=600
    ProxyPassReverse / http://127.0.0.1:8030/

    ErrorLog ${APACHE_LOG_DIR}/dogmedia-error.log
    CustomLog ${APACHE_LOG_DIR}/dogmedia-access.log combined
</VirtualHost>
```

For HTTP-only use on a trusted LAN, put the proxy directives in the port 80
virtual host instead of redirecting, and set `X-Forwarded-Proto` to `http`.
Public deployments should use HTTPS.

Enable and validate the site:

```bash
sudo a2ensite dogmedia.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

On Fedora/RHEL-family systems, place the virtual host in
`/etc/httpd/conf.d/dogmedia.conf`, verify it with `sudo apachectl configtest`,
and reload `httpd`. Ensure the host firewall exposes 80/443 but does not expose
ports 3001, 5440, 8030, or 16379 to untrusted networks.

Verify from a different client machine, not from the server itself:

```bash
curl https://media.example.com/api/check-access
```

The JSON `ip` value should match that client's address. If Apache is itself
behind a CDN, load balancer, or router proxy, configure Apache `mod_remoteip`
for only that proxy's documented address ranges before relying on the value.

References: [Apache reverse-proxy headers](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html.en),
[Apache request-header handling](https://httpd.apache.org/docs/2.4/mod/mod_headers.html),
[Nginx real-IP module](https://nginx.org/en/docs/http/ngx_http_realip_module.html),
and [Fastify proxy trust](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

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
- Apache sanitizes and forwards the client address; Nginx accepts forwarded
  addresses only from host loopback, and Fastify trusts only local Nginx
