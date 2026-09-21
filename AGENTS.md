# Agents.md — private-file-stream

## Stack

- **Backend**: FastifyJS (JavaScript)
- **Frontend**: React (Vite, JavaScript)
- **Database**: PostgreSQL (via `@fastify/postgres`)
- **Cache / Queue**: Redis (via `ioredis`)
- **Streaming**: media chunks (photo/video/music) served through Fastify streams
- **Containerization**: Podman + `podman compose`

## Project layout

```
private-file-stream/
├── server/              # Fastify backend (entry: server/src/index.js)
├── web/                 # React frontend (entry: web/src/main.jsx)
│   ├── index.html       # Vite entry point
│   ├── nginx.conf       # Nginx config with /api/ proxy to server
│   └── Containerfile    # 3-stage: deps → builder → nginx:alpine
├── compose.yml          # Podman Compose: db, server, web
├── server/Containerfile # Server multi-stage build (node:22-alpine)
├── .gitignore
├── .dockerignore
└── AGENTS.md
```

## Commands

```bash
# development
npm run dev          # starts both server + web (concurrently or via workspace)

# server only
npm run dev:server   # fastify with node --watch or nodemon

# web only
npm run dev:web      # vite dev

# build
npm run build        # vite build (web)

# lint (run before committing)
npm run lint         # eslint

# test
npm run test         # vitest (all)
npm run test:server  # server tests only
npm run test:web     # web tests only
```

## Conventions

- **File naming**: `kebab-case` for files, `camelCase` for variables/functions, `PascalCase` for React components.
- **API routes**: `server/src/routes/` — one file per resource, Fastify plugin pattern.
- **DB migrations**: `server/src/migrations/` — timestamp-prefixed, run via `npm run migrate` (use `node-pg-migrate` or `postgrator`).
- **Media storage**: Local files under `data/` (gitignored). In production, mount a Podman volume.
- **Streaming endpoints**: Return `fastify.reply.type()` + `pipe()` for media; use `Range` header support for video seeking.
- **Auth**: IP-based access control via PostgreSQL `ip_whitelist` table and CIDR matching (`server/src/plugins/auth.js`). Access tiers: 0 (guest), 100 (whitelisted media/admin access), 999 (localhost administrator). No user accounts or passwords.
- **Component style**: Functional components + hooks. CSS Modules or Tailwind (pick one, state in `web/README.md`).

## Containerization

```bash
# build and start all services
PFS_DB_PASSWORD=your_secret podman-compose up --build -d

# rebuild single service
podman-compose build server

# run migrations inside container
podman exec -it pfs-server npm run migrate

# run a shell in the server container
podman exec -it pfs-server sh
```

- `compose.yml` defines `db` (postgres:17-alpine), `redis` (redis:7-alpine), `server`, and `web` services.
- Environment: `PFS_DB_PASSWORD` (default `pfs_secret`), `REDIS_URL` (default `redis://redis:6379` in compose), `DATABASE_URL` (default `postgres://pfs:pfs_secret@localhost:5432/pfs` or via compose).
- Server depends on both `db` and `redis` health checks.
- Server `server/Containerfile`: 2-stage build — `npm ci --workspaces` in deps stage, then runner copies only `node_modules` + `server/`.
- Web `Containerfile`: 3-stage build — `npm ci` in deps, `vite build` in builder, final nginx:stable-alpine with dist + `nginx.conf`.
- `web/nginx.conf` proxies `/api/` requests to the `server` container.

## Redis usage

- **Queue** — per-IP media queue via Redis lists. Auto-filled from category when clicking media. Next/prev navigation via atomic operations.
- **Playback events** — sorted set (`playback:events`) for wrapped timeline/stats.
- **Active sessions** — per-IP string with 5min TTL (`playback:active:<ip>`), polled for now-playing dashboard.
- **Resume positions** — per-IP+media string with 7d TTL (`playback:resume:<ip>:<mediaId>`).
- Development requires Redis on localhost:6379 (or `REDIS_URL` env).

## Gotchas

- `@fastify/static` for thumbnail/file assets — configure `root` and `prefix` correctly.
- `@fastify/multipart` for upload handling — watch `limits.fileSize`.
- Podman runs rootless by default — ensure `data/` volume has correct UID/GID or use `:Z` flag.
- Video seeking requires `Content-Range` header logic — Fastify `onSend` hook or custom stream wrapper.
