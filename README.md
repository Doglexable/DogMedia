# Dogmedia

Self-hosted multimedia streaming server for photos, video, and audio. Access is
controlled by username/password accounts with access tiers.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Fastify 5 (JavaScript, ESM) |
| Frontend | React 19 + Vite 8 + Tailwind CSS v4 |
| Desktop client | Rust + Dioxus Native / Blitz / WGPU + GStreamer |
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
git clone https://github.com/Doglexable/Dogmedia.git
cd Dogmedia

# Create the local configuration. This file is ignored by Git.
cp .env.example .env
chmod 600 .env
```

Edit `.env`: replace `PFS_DB_PASSWORD=pfs_secret` with a strong password,
then set `PFS_ADMIN_USERNAME` and a unique `PFS_ADMIN_PASSWORD` (12–256 characters).
Migration `027` uses these values only when no administrator exists. Remove the
admin password from `.env` after the migration succeeds.
The Compose file supplies its own container addresses for PostgreSQL and Redis,
so the development `DATABASE_URL` and `REDIS_URL` values in `.env` do not need
to be changed for this setup.

Build the images, start the backing services, apply the database migrations,
and then start the application:

```bash
podman compose build
podman compose up -d db redis
podman compose run --rm server npm run migrate --workspace=server
podman compose up -d server worker web

# Confirm that all five services are running.
podman compose ps

# Test Nginx and Fastify locally. An unauthenticated request returns 401.
curl -i http://127.0.0.1:8030/api/check-access
```

The production UI listens on `http://127.0.0.1:8030` from the host. Use the
Apache setup below to publish it on ports 80/443. Fastify listens only on
`127.0.0.1:3001`; PostgreSQL and Redis use host ports `5440` and `16379`.

Useful lifecycle commands:

```bash
podman compose logs -f server worker web  # follow application logs
podman compose restart server worker web # restart application services
podman compose down               # stop containers; keep data
podman compose up --build -d      # rebuild and start after an update
podman compose exec server npm run migrate --workspace=server
```

### Upgrading an existing deployment

When updating an existing installation to account-based access, set
`PFS_ADMIN_USERNAME` and `PFS_ADMIN_PASSWORD` in `.env` before migrating.

```bash
# 1. Build the updated images and start the backing services
podman compose build
podman compose up -d db redis

# 2. Create the admin account and remove the obsolete IP whitelist table
podman compose run --rm server npm run migrate --workspace=server

# 3. Start the updated application
podman compose up -d server worker web

# 4. Consolidate category covers and backfill media encoding jobs if needed
podman compose exec server npm run backfill:media --workspace=server -- --dry-run
podman compose exec server npm run backfill:media --workspace=server
```

Do not use `podman compose down -v` unless volume deletion is intentional.
Persistent data is bind-mounted under `data/`: PostgreSQL in `data/postgres/`,
Redis in `data/redis/`, media in `data/media/`, temporary uploads in
`data/tmp/`, and Nginx logs in `data/nginx/`.

### Automatic startup with systemd (systemctl)

To keep Dogmedia running across system reboots and manage it as a system daemon, use the provided unit template [`systemd/dogmedia.service`](systemd/dogmedia.service).

#### Option A: Rootless User Service (Recommended for Podman)

Running Podman rootless is the recommended security best practice. A user-level systemd unit manages the Podman Compose stack without requiring root privileges:

```bash
# 1. Create the systemd user configuration directory
mkdir -p ~/.config/systemd/user

# 2. Copy the unit file
cp systemd/dogmedia.service ~/.config/systemd/user/

# 3. Ensure WorkingDirectory in ~/.config/systemd/user/dogmedia.service matches your clone location
#    (defaults to %h/Dogmedia where %h is your home directory)

# 4. Enable user lingering so containers start on boot and stay running after logout
loginctl enable-linger $USER

# 5. Reload systemd user daemon, enable and start the service
systemctl --user daemon-reload
systemctl --user enable --now dogmedia
```

Manage the user service:

```bash
systemctl --user status dogmedia     # check service status
systemctl --user restart dogmedia    # restart compose stack
systemctl --user stop dogmedia       # stop compose stack
journalctl --user-unit dogmedia -f   # view startup/shutdown logs
```

#### Option B: System-wide Service

If Dogmedia is deployed to `/opt/dogmedia` or another global directory:

```bash
# 1. Copy the unit file to the systemd system directory
sudo cp systemd/dogmedia.service /etc/systemd/system/

# 2. Edit /etc/systemd/system/dogmedia.service:
#    - Set WorkingDirectory to the absolute repository path (e.g. /opt/dogmedia)
#    - (Optional) Uncomment User= and Group= if running under a dedicated user
#    - Change WantedBy=default.target to WantedBy=multi-user.target

# 3. Reload daemon, enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable --now dogmedia
```

Manage the system service:

```bash
sudo systemctl status dogmedia
sudo systemctl restart dogmedia
sudo systemctl stop dogmedia
sudo journalctl -u dogmedia -f
```

### Development with live reload

The development override bind-mounts `server/` and `web/`, runs Fastify with
Node watch mode, and serves Vite on port 5173:

```bash
cp .env.example .env
# Set strong PFS_DB_PASSWORD and PFS_ADMIN_PASSWORD values in .env before continuing.

podman compose -f compose.yml -f compose.dev.yml up --build
```

In a second terminal, apply migrations once the database is healthy:

```bash
podman compose -f compose.yml -f compose.dev.yml \
  exec server npm run migrate --workspace=server
```

Open `http://localhost:5173`. Database, Redis, media, and temporary-file state
is shared with the production Compose setup under `data/`.

For development without containers, install Node.js 22, PostgreSQL, Redis, and ffmpeg;
run `npm ci`, update `.env` with reachable database/cache URLs and an admin
password, then run:

```bash
npm run migrate --workspace=server
npm run dev
# In a separate terminal (for background media encoding worker):
npm run worker
```

### Native desktop client

`desktop/` is a compiled Rust application using Dioxus Native, Blitz/WGPU,
and GStreamer. It does not embed Chromium, WebKit, or the React site. Install
Rust 1.88+, a Vulkan loader with Mesa or a vendor GPU driver, GStreamer 1.24+
with the required codecs, `pkg-config`, and a C toolchain. Build and run it
with:

```bash
npm run build:desktop
./desktop/target/release/dogmedia-desktop
```

Debian, Fedora, Arch, Flatpak, and cross-build prerequisites are documented in
[desktop/README.md](desktop/README.md). Debian and Fedora packages are written
to `dist/packages/` by the packaging commands below.

The first launch asks for the Dogmedia server URL and account credentials.
The desktop app retains a viewer ID for playback leases and resume state.
Audio and video playback is protected by a single global lease: another
viewer cannot start playback until the active client releases its lease or it
expires. Use HTTPS outside a trusted LAN.

Build and publish native Debian or Fedora packages with:

```bash
npm run package:desktop:deb # requires dpkg-dev
npm run package:desktop:rpm # requires rpm-build
npm run package:desktop:containers # builds both through Podman or Docker
```

If the container image was built but package export failed, reuse it without
building again, for example:

```bash
PFS_SKIP_PACKAGE_IMAGE_BUILD=1 npm run package:desktop:containers -- rpm
```

Each successful command writes packages to `dist/packages/` and publishes the
supported x64 package to `data/media/desktop-release/`. The container command
publishes after copying the package back to the host. Cross packaging does the
same for macOS and Windows when those builds succeed:

```bash
npm run package:desktop:cross -- mac
npm run package:desktop:cross -- windows
```

Set `PFS_PUBLISH_DESKTOP_RELEASE=0` before a packaging command to build without
publishing. To publish an already-built `.deb` without rebuilding, run:

```bash
bash desktop/packaging/publish-release.sh linux-deb dist/packages/dogmedia-desktop_0.7.0_amd64.deb
```

See [desktop/README.md](desktop/README.md) for Debian/Fedora prerequisites and
installation commands, user-local installation, Flatpak packaging, usage, and
current feature limits.

The packaging commands publish to `data/media/desktop-release/` (the server's
`DATA_DIR/desktop-release`) using these filenames:

| Package | Published filename |
| --- | --- |
| Debian / Ubuntu x64 | `dogmedia-linux-amd64.deb` |
| Fedora / RHEL x64 | `dogmedia-linux-x86_64.rpm` |
| Windows x64 | `dogmedia-windows-x86_64.exe` |
| macOS Apple silicon | `dogmedia-macos-arm64.zip` |
| macOS Intel | `dogmedia-macos-x86_64.zip` |

When upgrading from the old `.dmg` mapping to `.zip`, rebuild the server once
so the download API uses the new filenames and MIME type:

```bash
podman compose up -d --build server
```

Later package replacements need no extra Compose mount, image rebuild, or
server restart. The Windows installer is not currently present in
`dist/packages/`. Cross-built
macOS archives still need native runtime verification before relying on them.

The web sidebar detects the visitor's operating system and shows the matching
package choices. Visitors can select another platform manually. Unpublished
packages remain unavailable; publish only packages that have been built and
verified for that platform. The server streams published packages through
`/api/desktop-release/download/:id`.

## Compressing thumbnails

Use the bundled maintenance script to reduce the size of existing thumbnails.
It scans `data/media/` recursively for `front.webp`, `cover.webp`, and files
ending in `_thumb.jpg`, `_thumb.jpeg`, `_thumb.png`, or `_thumb.webp`.

When Node.js and FFmpeg are installed on the host, run:

```bash
npm run compress:thumbnails
```

The command prompts for a quality from 1 to 100 and defaults to `90`. In a
non-interactive shell it uses the default automatically. To process a media
directory outside the repository, set `DATA_DIR`:

```bash
DATA_DIR=/path/to/media npm run compress:thumbnails
```

For a Podman deployment, use the server image (which already contains FFmpeg)
and mount the repository's maintenance scripts into the temporary container:

```bash
podman compose run --rm \
  -v ./scripts:/app/scripts:ro,Z \
  server npm run compress:thumbnails
```

Before changing anything, the script copies every matching thumbnail to
`data/media/.thumbnail-backups/<timestamp>/`. Category artwork is limited to
518 px on its longest side and media `cover.webp` artwork to 900 px, without
upscaling smaller images. A compressed file replaces its original only when it
is smaller; unsupported WebP files and non-smaller results are skipped. The
summary prints the number of compressed, skipped, and failed files along with
the space saved and the exact backup directory.

To restore a run, replace `<timestamp>` with the directory printed by the
compression command:

```bash
cp -a data/media/.thumbnail-backups/<timestamp>/. data/media/
```

## Architecture

```text
Browser → Apache :80/:443 ┬→ Homepage Nginx :8040 (main domain)
                          └→ Web Nginx :8030 (private app) → Fastify :3001
                                                              ├─ PostgreSQL :5440
                                                              ├─ Redis :16379
                                                              └─ encoding worker (Redis Streams)
```

### Public homepage container

The `homepage` service is a separate static demo player on
`http://127.0.0.1:8040`. It uses the same Dogmedia charcoal, white, and rose
palette as the private app. Its three demo tracks are synthesized in the
visitor's browser; it does not request or expose private media. The existing
`web` service stays on `127.0.0.1:8030` and Fastify stays on `127.0.0.1:3001`.

```bash
podman compose up --build -d homepage
curl -I http://127.0.0.1:8040/
```

For the main domain, point the existing host Apache virtual host's root proxy
to `127.0.0.1:8040` instead of `127.0.0.1:8030`. Keep the private app's
existing `8030` listener; route its own hostname to that port if it must remain
accessible by domain. No Apache container is needed. The main-domain proxy
lines are:

```apache
ProxyPass        / http://127.0.0.1:8040/ connectiontimeout=5 timeout=60
ProxyPassReverse / http://127.0.0.1:8040/
```

Set those lines in the main domain's `VirtualHost`, then validate and reload
the host Apache configuration. The full private app proxy example below still
targets `8030` and can be used for its separate hostname.

All application containers use host networking. Apache removes any
client-supplied `X-Forwarded-For` value and adds the address of its direct
client. Nginx accepts that header only when the connection comes from loopback,
then sends a single normalized address to Fastify. Fastify trusts forwarding
headers only from its local Nginx peer. Consequently, `request.ip` is suitable
for rate limiting; authenticated queues, likes, resume state, and playback reports use a stable account identity.

### Apache reverse proxy and real client IP

The bundled `web/nginx.conf` trusts `X-Forwarded-For` only from `127.0.0.1` or
`::1`. Apache must therefore run on the same host as the containers and proxy to
`127.0.0.1:8030`. Do not broaden the trusted proxy ranges unless another known
proxy is deliberately added to the request path.

On Debian or Ubuntu, enable the required modules:

```bash
sudo a2enmod proxy proxy_http headers ssl
```

Playback updates use `POST /api/playback/socket-ticket` followed by a
credential-free WebSocket upgrade at `/api/playback/socket`. The first socket
message carries the short-lived, single-use ticket; keep the ticket and
protected playback IDs out of URLs and proxy access logs. The bundled Nginx
configuration forwards `Upgrade`, `Connection`, and the same normalized client
IP headers as ordinary `/api/` requests. Apache 2.4.47 or newer upgrades
WebSocket requests through `mod_proxy_http` with the `ProxyPass` rule below.
For older Apache versions, enable `proxy_wstunnel` and add a more specific
`ProxyPass /api/playback/socket ws://127.0.0.1:8030/api/playback/socket`
before the general `ProxyPass /` rule. Keep Apache and Nginx on the same host
so client address handling is consistent for HTTP and WebSocket.

If the public entry point is Nginx, its WebSocket location also needs to pass
the upgrade headers. Add this exact location to the public `server` block that
already proxies the app to `127.0.0.1:8030`, alongside its general `/` proxy:

```nginx
location = /api/playback/socket {
    proxy_pass http://127.0.0.1:8030;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
```

Use the public proxy's existing upstream if it differs from `127.0.0.1:8030`.
Without the upgrade headers, Fastify receives an ordinary GET for this route
and responds with 404 even though `/api/playback/socket-ticket` works.

Connected playback clients receive immediate lease changes and safe playing
snapshots. The server renews a bound native lease while its socket answers
pings. A paused Web player deliberately stops renewing; the existing
30-second lease expires unless playback resumes. On disconnect the lease keeps
its normal Redis grace period. Clients temporarily use the HTTP heartbeat and
lease status routes while reconnecting; those routes also support older client
versions. Mobile background audio depends on the operating system continuing
JavaScript and socket activity, so validate Android and iOS behavior before
relying on uninterrupted background playback.

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
curl -i https://media.example.com/api/check-access
```

An unauthenticated request should return `401 Login required`. If Apache is itself
behind a CDN, load balancer, or router proxy, configure Apache `mod_remoteip`
for only that proxy's documented address ranges before relying on the value.

References: [Apache reverse-proxy headers](https://httpd.apache.org/docs/2.4/mod/mod_proxy.html.en),
[Apache request-header handling](https://httpd.apache.org/docs/2.4/mod/mod_headers.html),
[Nginx real-IP module](https://nginx.org/en/docs/http/ngx_http_realip_module.html),
and [Fastify proxy trust](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

## Accounts and first setup

Set `PFS_ADMIN_USERNAME` and `PFS_ADMIN_PASSWORD` in the local `.env` file, then
run migrations before starting the server. Migration `027_seed_admin.js` creates
a tier-999 administrator if none exists, using a salted scrypt password hash.
It leaves an existing administrator unchanged. Migration `028` removes the old
IP whitelist table. Migration `029` replaces PostgreSQL IP ownership columns
with `user_id`; data with no matching account is kept under disabled archive
accounts. Remove `PFS_ADMIN_PASSWORD` from `.env` after migration.

Log in through the web, mobile, or desktop client. Later registrations receive
tier 0 and can be made from any address that can reach the server. Browser
sessions use an HttpOnly cookie; native clients use the returned Bearer token.
`POST /api/auth/logout` revokes the current session. Existing favorites and
playback history from IP-only access is preserved under disabled archive
accounts. Account activity is stored under `users.id`.

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
- **media_encoding_variants** — low/medium/high derivatives and their durable
  queue status; originals remain untouched and are always the final fallback
- **users** — username, password hash, and access tier
- **music_shares** — hashed, expiring, revocable links for individual audio tracks

## Redis

Media upload completion returns `202 Accepted` immediately. Source assembly and
persistence run through the `media:upload-completion` Redis Stream; the browser
polls the upload status endpoint until that work finishes. Metadata probing,
automatic artwork extraction, and the handoff to encoding then run through the
`media:finalization` Redis Stream. Encoding jobs use the `media:encoding` Redis
Stream. The Compose worker defaults to one encoder; set `ENCODING_CONCURRENCY` to raise
concurrency deliberately. Abandoned chunk sessions are removed after 30 minutes
without activity; the interval and idle threshold can be changed with the
`INCOMPLETE_UPLOAD_CLEANUP_*` environment variables.
After applying migration `014`, consolidate legacy thumbnails and enqueue the
existing library with an idempotent backfill:

```bash
# Inspect the proposed cover selection and encoding count first.
podman compose run --rm server npm run backfill:media --workspace=server -- --dry-run

# Create category front.webp files, back up old per-media thumbnails, and queue media.
podman compose run --rm server npm run backfill:media --workspace=server
```

Legacy thumbnails are moved only after the new cover is verified. The command
prints conflicts and categories for which no usable cover could be found.

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `queue:<account-identity>` | List | — | Per-account media queue (auto-filled from category) |
| `queue:index:<ip>` | String | — | Current position in queue |
| `playback:events` | Sorted set | — | Timestamped event log for Wrapped |
| `playback:active:<ip>` | String | 5 min | Active session for now-playing dashboard, including loop/shuffle state |
| `playback:resume:<ip>:<mediaId>` | String | 15 min (900s, via `PLAYBACK_RESUME_TTL_SECONDS`) | Last known position for continue-watching |
| `music:reel-render` | Stream | — | Background FFmpeg jobs for favorite music reels |
| `media:upload-completion` | Stream | — | Chunk assembly and source persistence jobs |
| `media:finalization` | Stream | — | Post-upload metadata and artwork jobs |
| `public-music-reel:session:<id>` | String | 4 hours | Temporary public video-stream session |

## API

| Route | Auth | Description |
|-------|------|-------------|
| `GET /api/check-access` | Account | Returns `{ tier, description, username, id }` |
| `GET /api/categories` | Account | Lists categories visible to your tier |
| `GET /api/media` | Account | Lists media visible to your tier, including category folder metadata |
| `GET /api/media/:id/stream` | Account | Streams file with Range support |
| `POST /api/media` | Tier ≥ 100 | Upload media file (multipart) |
| `PUT /api/media/:id` | Tier ≥ 100 | Update media metadata |
| `DELETE /api/media/:id` | Tier ≥ 100 | Delete media |
| `GET /api/music-shares/current` | Account | Read the current account's favorite-reel render status |
| `POST /api/music-shares` | Tier ≥ `MEDIA_SHARE_MIN_TIER` | Queue a lyric-aware 4:3 clip for one accessible track, or a reel from up to 10 favorites |
| `DELETE /api/music-shares/current` | Account | Revoke the current favorite reel |
| `POST /api/public/music/session` | Public token | Read reel progress or exchange a ready token for a temporary video session |
| `GET /api/public/music/session/:sessionId/stream` | Public session | Stream the rendered MP4 reel with Range support |
| `GET /api/public/music/session/:sessionId/download` | Public session | Download the rendered MP4 reel as an attachment |
| `GET/POST/PUT/DELETE /api/categories/:id` | Tier ≥ 100 | CRUD categories |
| `POST /api/auth/register` | Public | Create tier-0 account |
| `POST /api/auth/login` | Public | Log in |
| `POST /api/auth/logout` | Account | Revoke current session |
| `POST /api/queue/auto/:categoryId` | Account | Fill queue with category media |
| `POST /api/queue/next` | Account | Advance queue, return next mediaId |
| `POST /api/queue/prev` | Account | Go back, return prev mediaId |
| `POST /api/queue/select` | Account | Jump queue index to a chosen mediaId |
| `POST /api/queue/items` | Account | Append one accessible, unique media item |
| `PUT /api/queue/order` | Account | Atomically reorder the current queue |
| `DELETE /api/queue/items/:mediaId` | Account | Remove one queue item |
| `DELETE /api/queue` | Account | Clear the current queue |
| `GET /api/likes` | Account | List the current account's liked music |
| `PUT /api/likes/:mediaId` | Account | Like an accessible audio item |
| `DELETE /api/likes/:mediaId` | Account | Remove an audio item from likes |
| `GET /api/likes/share` | Account | Check whether secret-link sharing is enabled |
| `POST /api/likes/share` | Account | Generate or rotate a titles-only secret link |
| `DELETE /api/likes/share` | Account | Revoke the current secret link |
| `GET /api/public/liked-music/:token` | Public token | Read shared music titles only |
| `POST /api/playback/event` | Account | Log play/pause/end/skip event and update active session |
| `POST /api/playback/active` | Account | Update now-playing state without adding a Wrapped event |
| `GET /api/playback/active` | Account | Return the caller's active playback session for hard-refresh restore |
| `GET /api/playback/resume/:mediaId` | Account | Get saved resume position |
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

- Clicking a media item inside a selected category auto-fills an account queue
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
npm run dev:desktop      # native Dioxus/Blitz desktop client
npm run migrate          # run DB migrations
npm run build            # Vite production build
npm run build:desktop    # release desktop binary
npm run clean:desktop    # clean desktop Cargo build cache (frees target/)
npm run lint             # ESLint
npm run test             # Vitest (all)
npm run test:server      # server tests
npm run test:web         # web tests
npm run test:desktop     # Rust desktop tests
```

## Disk space and cleanup

Local builds, compiler targets, and packaging toolchains generate artifacts that can consume significant disk space (frequently 20–30+ GB across the workspace).

### Safe to delete (reclaim disk space)

| Path | Typical size | Description & cleanup command |
|---|---|---|
| `desktop/target/` | **20+ GB** | Cargo build cache, intermediate object files, and compiled binaries for the desktop client. Rebuilds automatically on next `cargo build` or `cargo run`.<br>`cargo clean --manifest-path desktop/Cargo.toml` or `rm -rf desktop/target` |
| `desktop/packaging/macos/__pycache__/` | Few KB | Python bytecode cache from macOS packaging scripts. Safe to delete. |
| `desktop/bundle/`, `desktop/.dioxus/` | Variable | Ephemeral Dioxus packaging output if present. |
| `dist/`, `mobile/dist/` | ~1.8 GB | Vite and frontend production build output. Re-generated with `npm run build`. |
| `mobile/android/app/build/`, `mobile/android/.gradle/` | ~2.8 GB | Android Gradle build cache and APK output.<br>`rm -rf mobile/android/app/build mobile/android/.gradle` (or `./gradlew clean` in `mobile/android`). |
| `.flatpak-builder/`, `.flatpak-build/` | ~90 MB | Local Flatpak build caches. |
| `pfs-sdk/` | ~4.8 GB | Downloaded GStreamer installers, macOS SDK tarballs, and Zig toolchains used for cross-platform packaging. Safe to remove if not currently packaging release binaries. |
| `node_modules/` | ~10 GB | Node dependencies. Can be deleted and cleanly restored anytime with `npm ci`. |

### DO NOT delete (tracked source & critical assets)

- **`desktop/vendor/`**: Contains local vendored crates (`dioxus-native`, `wgpu_context`). Tracked in Git and required for compiling the desktop client.
- **`desktop/src/`**, **`desktop/assets/`**, **`desktop/resources/`**, **`desktop/packaging/`**, **`desktop/tests/`**, **`desktop/flatpak/`**, **`desktop/scripts/`**: Tracked application source, icons, packaging scripts, and metadata.
- **`data/`**: Persistent media libraries, uploads, PostgreSQL database, and Redis runtime files. Only delete if intentionally resetting the server.

### Quick cleanup commands

```bash
# 1. Clean Rust desktop build cache (frees ~20+ GB)
cargo clean --manifest-path desktop/Cargo.toml

# 2. Clean web and mobile build artifacts
rm -rf dist/ mobile/dist/ mobile/android/app/build/ .flatpak-builder/ .flatpak-build/

# 3. Optional: remove downloaded cross-compile SDKs (frees ~4.8 GB)
rm -rf pfs-sdk/
```

## Security notes

- Media files stored under `data/media/` (gitignored, bind-mounted by Podman)
- Private API access requires an account session
- Streaming uses `Range` headers for seeking — no pre-signed URLs
- The administrator is seeded by migration from local environment variables
- Apache sanitizes and forwards the client address; Nginx accepts forwarded
  addresses only from host loopback, and Fastify trusts only local Nginx

## Credits

- Line-synchronized lyrics provided by [LRCLIB](https://lrclib.net/).
