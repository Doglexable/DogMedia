# Plan 012: Correct Misleading JWT Authentication in AGENTS.md

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- AGENTS.md README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

`AGENTS.md:61` documents `Auth: JWT-based, middleware in server/src/plugins/auth.js` and mentions `PFS_JWT_SECRET`. However, the entire DogMedia architecture is built on IP-based authorization (`ip_whitelist`, CIDR subnets, and access tiers) with zero user accounts, tokens, or JWTs. This misleading doc causes agents and developers to search for nonexistent login endpoints and headers.

Updating `AGENTS.md` and `README.md` to accurately document the IP whitelist model aligns project documentation with reality.

## Current state

- `AGENTS.md:61-62`:
```markdown
- **Auth**: JWT-based, middleware in `server/src/plugins/auth.js`.
...
- Environment: `PFS_DB_PASSWORD` (default `pfs_secret`), `PFS_JWT_SECRET` (default `change_me_in_production`), `REDIS_URL` (default `redis://redis:6379` in compose).
```

## Scope

**In scope**:
- `AGENTS.md`
- `README.md`

## Steps

### Step 1: Update AGENTS.md and README.md

- Replace JWT descriptions with the canonical IP-based authorization model:
  - Access is IP-based via `ip_whitelist` table with CIDR ranges and numeric access tiers.
  - Tier 999 = Localhost / Administrator.
  - Tier 100 = Full media access & admin workspace.
  - Tier 0 = Public / Guest.
- Remove references to `PFS_JWT_SECRET`.

## Done criteria

- [ ] `AGENTS.md` accurately documents IP-based whitelist auth.
