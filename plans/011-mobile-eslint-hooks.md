# Plan 011: Configure Mobile ESLint and Enable React Hooks Linting

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- mobile/eslint.config.js web/eslint.config.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

`mobile/eslint.config.js` currently contains `export default [{}];`, performing zero lint inspections on the mobile React Native codebase. Consequently, undefined variables, missing imports, syntax errors, and stale React hook closures in `mobile/src/` go undetected by `npm run lint`.

Configuring standard ESLint flat config with React and React Hooks rules provides automated static analysis across all workspaces.

## Current state

- `mobile/eslint.config.js`:
```javascript
export default [{}];
```

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Lint      | `npm run lint --workspace=mobile` | exit 0     |

## Scope

**In scope**:
- `mobile/eslint.config.js`
- `web/eslint.config.js`

**Out of scope**:
- Modifying React component behavior.

## Git workflow

- Branch: `advisor/011-mobile-eslint-hooks`
- Commit message: `chore(mobile): configure eslint flat config and react hooks rules`

## Steps

### Step 1: Configure Mobile ESLint Config

In `mobile/eslint.config.js`:
- Match the flat configuration pattern in `server/eslint.config.js` and `web/eslint.config.js`.
- Add globals for React Native and browser/node environments.
- Enable `no-undef`, `no-unused-vars`, and React Hook dependency rules.

### Step 2: Verify

Run `npm run lint --workspace=mobile`. Address any trivial unused import warnings surfaced.

## Done criteria

- [ ] `npm run lint` exits 0 across all workspaces.
