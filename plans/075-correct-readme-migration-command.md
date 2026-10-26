# Plan 075: Show a runnable migration command in the README

> **Executor instructions**: Follow the steps and gates below. Update only this plan's status row in `plans/README.md` when done. Stop at the listed conditions.
>
> **Drift check first**: `git diff --stat d436e4f..HEAD -- README.md package.json server/package.json`. If the command list or scripts changed, compare the excerpts below with live files before editing.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW; documentation correction only.
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `d436e4f`, 2026-10-26

## Why this matters

The README command reference tells a local developer to run `npm run migrate`, but the repository has no root `migrate` script. Copying the command fails before database migrations run. An earlier setup section already shows the correct workspace command.

## Current state

- `README.md:189-198` correctly gives `npm run migrate --workspace=server` for standalone development.
- `README.md:724-739` lists project commands, including:
  ```text
  npm run migrate          # run DB migrations
  ```
- `package.json:11-40` has root scripts but no `migrate`; `server/package.json` defines `"migrate": "node --env-file-if-exists=../.env src/migrate.js"`.
- Documentation uses shell code fences and inline comments for command descriptions. Preserve that style.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Check root scripts | `npm run` | lists root scripts; does not list `migrate` |
| Check server scripts | `npm run --workspace=server` | lists `migrate` |
| Check the documented line | `rg -n 'npm run migrate' README.md` | every local invocation includes `--workspace=server`; Compose command also includes it |

## Scope

**In scope**: `README.md`, this plan's row in `plans/README.md`.

**Out of scope**: `package.json`, `server/package.json`, migration code/schema, Compose examples unrelated to this command, and AGENTS.md wording.

## Git workflow

Use `advisor/075-correct-readme-migration-command` and a conventional commit such as `docs: correct local migration command`. Do not push or open a PR without operator instruction.

## Steps

### Step 1: Confirm the script location

Read the root and server script lists. Confirm the current `README.md` setup section uses the server workspace command and the command reference has the single wrong line. Do not run the migration just to verify a documentation change; it requires a configured database and mutates it.

**Verify**: `npm run && npm run --workspace=server` → root list lacks `migrate`, server list includes it.

### Step 2: Correct the command reference

Change only the command reference line at `README.md:731` to `npm run migrate --workspace=server  # run DB migrations`, aligning it with the earlier local setup section. Keep the surrounding command list and descriptions intact.

**Verify**: `rg -n 'npm run migrate' README.md` → all README examples point at the server workspace; `git diff --check -- README.md` exits 0.

## Test plan

No new automated test is justified for this one-line documentation change. The script-list and text checks above directly verify the documented command without applying migrations to a database.

## Done criteria

- [ ] `npm run` and `npm run --workspace=server` confirm the script location.
- [ ] `rg -n 'npm run migrate' README.md` shows no bare local command.
- [ ] `git diff --check -- README.md` exits 0.
- [ ] Only README and this plan's index row change.

## STOP conditions

- A root `migrate` script was added after the plan's commit; re-evaluate whether the README line is now valid.
- Other README command examples or package scripts changed so this is no longer a one-line correction.

## Maintenance notes

When changing workspace scripts, update the README command reference and the setup section together. This plan does not address the separate AGENTS.md Compose-description drift found in the same audit.
