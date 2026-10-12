# Plan 061: Run server, web, and mobile checks in CI

> **Executor instructions**: Follow this plan step by step. Run each verification
> command and confirm its expected result before moving on. Stop at any STOP
> condition rather than expanding the workflow scope.
>
> **Drift check (run first)**: `git diff --stat c26a4d4..HEAD -- .github/workflows package.json package-lock.json server/package.json web/package.json mobile/package.json`
> If an in-scope file changed after this plan was written, compare the current
> state below with the live code before proceeding.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests / dx
- **Planned at**: commit `c26a4d4`, 2026-10-12

## Why this matters

The repository has runnable server, web, and mobile test and lint commands, but
the only current GitHub Actions workflow validates the native desktop client.
Changes to the API, browser app, or mobile app therefore do not receive the
same automatic regression checks. Add a Node CI workflow that runs the existing
root checks and web production build on relevant pushes and pull requests.

## Current state

- `.github/workflows/desktop-native.yml` runs desktop-only Rust checks. Its
  triggers include `desktop/**`, the workflow itself, and `package.json`.
- Root `package.json` is an npm workspace with `server`, `web`, and `mobile`.
  `npm run lint` and `npm test` run the corresponding commands in all three
  workspaces. `npm run build` builds the web workspace.
- `server/Containerfile` uses Node 22, so use Node 22 in the workflow.
- The repository uses `package-lock.json`; install with `npm ci`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 using the committed lockfile |
| Lint | `npm run lint` | exit 0 for server, web, and mobile |
| Tests | `npm test` | all three workspace suites pass |
| Web build | `npm run build` | Vite production build exits 0 |

## Scope

**In scope**:

- `.github/workflows/node-workspaces.yml` (create)
- `plans/README.md` (status and execution order only)

**Out of scope**:

- `.github/workflows/desktop-native.yml` — preserve the existing Rust gates.
- Any application source, package manifests, lockfiles, or test files.
- Android/iOS native builds; these are not part of the existing root checks.

## Git workflow

- Branch: `advisor/061-add-workspace-ci`
- Commit style: match the repository's imperative `ci:` / `test:` prefixes.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add the Node workspace workflow

Create `.github/workflows/node-workspaces.yml`. Trigger on pull requests and
pushes that change the workflow, root `package.json` or `package-lock.json`,
`server/**`, `web/**`, or `mobile/**`. Use `actions/checkout@v4`,
`actions/setup-node@v4` with Node 22 and npm caching keyed by
`package-lock.json`, then run `npm ci`, `npm run lint`, `npm test`, and
`npm run build` in that order. Give the job a finite timeout and grant only
`contents: read` permissions. Do not add secrets or deployment steps.

**Verify**: `git diff --check` → exit 0; inspect the workflow and confirm every
trigger, command, permission, and Node version matches this step.

### Step 2: Verify the complete CI command set locally

Run the commands in the table above from the repository root. Fix only issues
caused by the new workflow configuration; report existing failures rather than
changing unrelated application code.

**Verify**: `npm run lint && npm test && npm run build` → exit 0.

## Test plan

No application tests are needed for this workflow-only change. The workflow
itself executes the existing server, web, and mobile test suites on each
qualifying CI run.

## Done criteria

- [ ] The new workflow runs on relevant server, web, and mobile changes.
- [ ] CI installs from the committed lockfile with Node 22.
- [ ] CI runs root lint, test, and web build commands.
- [ ] CI has read-only repository permissions and no publishing steps.
- [ ] `npm run lint`, `npm test`, and `npm run build` exit 0 locally.
- [ ] No files outside the in-scope list are modified.
- [ ] The Plan 061 status row in `plans/README.md` is updated.

## STOP conditions

- Stop if the root scripts no longer cover all three npm workspaces.
- Stop if CI requires native mobile SDK setup to run the current Vitest suites.
- Stop if a verification failure predates this workflow and requires source
  changes outside scope.

## Maintenance notes

Keep desktop native validation in its existing workflow. If the root scripts or
workspace list change, update this workflow's commands and triggers together.
The web build is included because it catches bundler failures that lint and
tests do not cover.
