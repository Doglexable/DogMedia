# Plan 009: Wrap Database Migrations in Transactions and Ensure Idempotency

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- server/src/migrate.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

In `server/src/migrate.js:32-37`, migration files are executed sequentially against PostgreSQL without an encompassing transaction (`BEGIN` / `COMMIT`). If a multi-statement migration errors out midway, partial DDL remains in the database while `_migrations` does not record the file as completed. When `npm run migrate` is retried, the initial statements in that file fail because tables, columns, or types already exist.

Fixing this by wrapping each migration file in a single PostgreSQL transaction guarantees atomic execution.

## Current state

- `server/src/migrate.js:32-37`:
```javascript
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    console.log(`Running ${file}...`);
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    console.log(`Done ${file}`);
```

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Lint      | `npm run lint --workspace=server` | exit 0     |

## Scope

**In scope**:
- `server/src/migrate.js`

**Out of scope**:
- Historical migration SQL files.

## Git workflow

- Branch: `advisor/009-transactional-migrations`
- Commit message: `fix(server): wrap database migrations in atomic transactions`

## Steps

### Step 1: Wrap Migration Execution in BEGIN / COMMIT Blocks

In `server/src/migrate.js`:
```javascript
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Done ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
```

### Step 2: Verify

Run `npm run lint --workspace=server`.

## Done criteria

- [ ] `npm run lint --workspace=server` exits 0.
- [ ] Failed migrations cleanly rollback without leaving partial unrecorded DDL.
