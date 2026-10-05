# Plan 024: Upgrade Fastify, Find-My-Way, and React-Router-DOM to Remediate Security Advisories

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 50f1f36..HEAD -- server/package.json web/package.json package-lock.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/015-fix-site-footer-rgb-tokens.md
- **Category**: deps
- **Planned at**: commit `50f1f36`, 2026-09-22

## Why this matters

`npm audit` reports several High-severity security advisories affecting reachable runtime code:
1. `fastify <= 5.12.0` (GHSA-3m5p-2c4r-xxw2): `X-Forwarded-*` header spoofing vulnerability when reverse proxies hop, risking CIDR bypass.
2. `find-my-way <= 9.6.0` (GHSA-c96f-x56v-gq3h): High-severity Denial of Service vulnerability via HTTP/2 route parsing.
3. `react-router / react-router-dom 6.0.0 - 7.18.1` (GHSA-wrjc-x8rr-h8h6): Open redirect vulnerability via backslash-encoded paths in `<Link>` and `useNavigate`, and client DoS via inefficient route matching (GHSA-chx6-hx7r-mcp5).
Updating Fastify to `^5.12.5` and `react-router-dom` to `^7.18.2` patches these vulnerabilities via semver-compatible minor/patch upgrades without breaking application code.

## Current state

The relevant files:
- `server/package.json` — Fastify backend dependencies.
- `web/package.json` — React frontend dependencies.
- `package-lock.json` — root lockfile.

Current-state excerpts:
`server/package.json:15-22`:
```json
  "dependencies": {
    "@fastify/cors": "^11.0.0",
    "@fastify/multipart": "^10.0.0",
    "@fastify/postgres": "^6.0.0",
    "fastify": "^5.0.0",
    "ioredis": "^5.0.0",
    "pg": "^8.0.0"
  },
```

`web/package.json:25-30`:
```json
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "tailwindcss": "^4.3.0",
    "vaul": "^1.1.2"
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server tests | `npm run test:server` | all pass |
| Web tests | `npm run test:web` | all pass |
| Web build | `npm run build` | exit 0 |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope**:
- `server/package.json` — bump `fastify` to `^5.12.5`.
- `web/package.json` — bump `react-router-dom` to `^7.18.2`.
- `package-lock.json` — update lockfile for patched versions.

**Out of scope**:
- Upgrading major versions of other packages (e.g. React 19 or Expo 57).
- Modifying routing or Fastify plugin architecture.

## Git workflow

- Branch: `advisor/024-upgrade-vulnerable-dependencies`
- Commit style: `deps: bump fastify and react-router-dom to patch security advisories`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Bump `fastify` in `server/package.json`

Open `server/package.json`. In `"dependencies"`, update:
```json
"fastify": "^5.12.5",
```

### Step 2: Bump `react-router-dom` in `web/package.json`

Open `web/package.json`. In `"dependencies"`, update:
```json
"react-router-dom": "^7.18.2",
```

### Step 3: Update lockfile and run verification

Run `npm install` inside the executor workspace to regenerate `package-lock.json`:
**Verify**: `npm run test:server` → all 26 test files pass.
**Verify**: `npm run test:web` → all 29 test files pass.
**Verify**: `npm run build` → exit 0.
**Verify**: `npm run lint` → exit 0.

## Test plan

- Verify Fastify server boots and passes all route tests.
- Verify React Router navigation and route matching builds and passes all web tests.
- Verify `npm run lint` and `npm run test` exit 0.

## Done criteria

- [ ] `fastify` in `server/package.json` is `>= 5.12.5`
- [ ] `find-my-way` in `package-lock.json` resolves to `>= 9.6.1`
- [ ] `react-router-dom` in `web/package.json` is `>= 7.18.2`
- [ ] `npm run test` exits 0 across all workspaces
- [ ] `npm run build` exits 0

## STOP conditions

- If `npm run build` or `npm run test:web` encounters incompatible API changes in `react-router-dom`.

## Maintenance notes

- Run `npm audit` periodically to monitor for patch releases across transitive dependencies.
