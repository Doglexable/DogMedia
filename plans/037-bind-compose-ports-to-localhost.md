# Plan 037: Bind Compose database and cache ports to localhost only

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat edc7905..HEAD -- compose.yml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `edc7905`, 2026-10-04

## Why this matters

The `compose.yml` publishes PostgreSQL on port 5440 and Redis on port 16379 without binding to a specific interface, defaulting to `0.0.0.0`. This exposes both services to all network interfaces, allowing any host on the local network (or the internet if the machine has a public IP) to connect directly. Redis runs without authentication (`requirepass`), enabling unauthenticated read/write access to playback sessions, queues, resume positions, and active sessions.

`AGENTS.md` already documents these services as running on `127.0.0.1` — this fix aligns the actual configuration with the documented intent.

## Current state

Relevant files:
- `compose.yml` — Podman Compose service definitions

**`compose.yml:10-11`** (PostgreSQL port exposed on 0.0.0.0):
```yaml
    ports:
      - "5440:5432"
```

**`compose.yml:22-23`** (Redis port exposed on 0.0.0.0):
```yaml
    ports:
      - "16379:6379"
```

**`compose.yml:21`** (Redis without authentication):
```yaml
    command: ["redis-server", "--appendonly", "yes"]
```

**Repo conventions**: Compose file uses Podman Compose syntax. Server, worker, and web services already use `network_mode: host` (lines 39, 68, 99). The `AGENTS.md` documents services on `127.0.0.1`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Compose syntax | `podman-compose -f compose.yml config` | exit 0, valid YAML |

Note: Do NOT run `podman-compose up` — this plan only modifies configuration.

## Scope

**In scope** (the only files you should modify):
- `compose.yml`
- `compose.dev.yml` — added with operator approval after the development override was found to conflict with Redis authentication

**Out of scope** (do NOT touch):
- Server application code — connection strings already use `127.0.0.1`
- `.env` or `.env.example` — no changes needed

## Git workflow

- Branch: `fix/037-compose-localhost-binding`
- Commit style: `fix(compose): bind database and cache ports to localhost only`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Bind PostgreSQL port to localhost

In `compose.yml`, change line 11:

From:
```yaml
      - "5440:5432"
```

To:
```yaml
      - "127.0.0.1:5440:5432"
```

**Verify**: `grep '5440' compose.yml` → shows `127.0.0.1:5440:5432`

### Step 2: Bind Redis port to localhost and add authentication

In `compose.yml`, change line 23:

From:
```yaml
      - "16379:6379"
```

To:
```yaml
      - "127.0.0.1:16379:6379"
```

Also change line 21 to add `requirepass`:

From:
```yaml
    command: ["redis-server", "--appendonly", "yes"]
```

To:
```yaml
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${PFS_REDIS_PASSWORD:-pfs_redis_secret}"]
```

Then update the `REDIS_URL` in the server and worker environment sections (lines 47 and 76) to include the password:

From:
```yaml
      REDIS_URL: redis://127.0.0.1:16379
```

To:
```yaml
      REDIS_URL: redis://:${PFS_REDIS_PASSWORD:-pfs_redis_secret}@127.0.0.1:16379
```

Update the Redis healthcheck (line 27) to authenticate:

From:
```yaml
      test: ["CMD", "redis-cli", "ping"]
```

To:
```yaml
      test: ["CMD", "redis-cli", "-a", "${PFS_REDIS_PASSWORD:-pfs_redis_secret}", "ping"]
```

**Verify**: `grep '16379' compose.yml` → shows `127.0.0.1:16379:6379`
**Verify**: `grep 'requirepass' compose.yml` → shows requirepass in Redis command

### Step 3: Validate compose syntax

**Verify**: `podman-compose -f compose.yml config 2>&1 | head -5` → valid YAML output (or `docker compose -f compose.yml config` if podman-compose is unavailable)

## Test plan

No automated tests needed — this is a configuration-only change. Verify by:
- Confirming `podman-compose config` parses successfully
- `grep` commands confirming localhost binding

## Done criteria

- [ ] `grep '127.0.0.1:5440' compose.yml` returns a match
- [ ] `grep '127.0.0.1:16379' compose.yml` returns a match
- [ ] `grep 'requirepass' compose.yml` returns a match
- [ ] `grep 'PFS_REDIS_PASSWORD' compose.yml` returns matches for Redis command and REDIS_URL
- [ ] No files outside the in-scope list are modified

## STOP conditions

Stop and report back if:
- The compose.yml structure doesn't match the excerpts (services reordered or renamed)
- `compose.dev.yml` overrides the port bindings in a way that would conflict
- Redis authentication breaks the server/worker startup (check `REDIS_URL` format)

## Maintenance notes

- The `.env.example` file should document `PFS_REDIS_PASSWORD` — this is deferred from this plan.
- If external Redis monitoring tools need access, they must connect via `127.0.0.1` and supply the password.

## Implementation

Completed on 2026-10-04. PostgreSQL and Redis published ports are bound to
localhost, Redis requires `PFS_REDIS_PASSWORD`, and its healthcheck, server, and
worker use authenticated connections. After the original plan hit a STOP
condition, the operator approved expanding scope to update `compose.dev.yml` so
the development override cannot replace the authenticated Redis URL.
