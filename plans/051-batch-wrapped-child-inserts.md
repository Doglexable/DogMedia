# Plan 051: Batch wrapped-report child writes into single INSERTs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 2bf8caa..HEAD -- server/src/routes/wrapped.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `2bf8caa`, 2026-10-06

## Why this matters

Saving a wrapped report issues one INSERT per top-media item plus one per
timeline day — N round trips inside the transaction, scaling with period
length. Two multi-row INSERTs do the same work in constant round trips with
the identical transaction boundary and row contents.

## Current state

Relevant files:

- `server/src/routes/wrapped.js:428-480` — `replaceTopMedia` and
  `replaceTimeline`, called inside `withTransaction` (`wrapped.js:482+`).
- Wrapped route tests (`server/src/routes/wrapped.test.js` — verify name).
- Normalizer helpers used by both functions: `normalizeNullableInt`,
  `normalizeNonNegativeInt`, `normalizeDate` (same file — reuse them when
  building row arrays).

```js
// server/src/routes/wrapped.js:428-459 — one INSERT per item
async function replaceTopMedia(client, reportId, topMedia = []) {
  await client.query("DELETE FROM wrapped_top_media WHERE wrapped_report_id = $1", [reportId]);
  for (const [index, item] of topMedia.entries()) {
    ...
    await client.query(
      `INSERT INTO wrapped_top_media (...) VALUES ($1, $2, COALESCE(NULLIF($3, ''), (SELECT title FROM media_assets WHERE id = $2), $4), $5, $6, $7)`,
      [reportId, mediaId, title, fallbackTitle, ...]
    );
  }
}
```

```js
// server/src/routes/wrapped.js:461-480 — one INSERT per day
async function replaceTimeline(client, reportId, timeline = []) {
  await client.query("DELETE FROM wrapped_timeline_days WHERE wrapped_report_id = $1", [reportId]);
  for (const item of timeline) {
    const activityDate = normalizeDate(item.date ?? item.activity_date);
    if (!activityDate) continue;
    await client.query(`INSERT INTO wrapped_timeline_days (...) VALUES ($1, $2, $3, $4)`, [...]);
  }
}
```

Note the title-fallback subselect `(SELECT title FROM media_assets WHERE id = $2)`
inside the per-row insert — the batched version must preserve it per row.

Repo conventions: `client.query` inside `withTransaction`, normalizer helpers,
inject-pattern tests.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Server tests | `npm run test:server` | all pass |
| Lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:

- `server/src/routes/wrapped.js` (`replaceTopMedia`, `replaceTimeline` only)
- Wrapped route tests (extend)

**Out of scope**:

- Changing row contents, normalizer behavior, or the DELETE-then-INSERT
  transaction semantics.
- Annual-Wrapped changes (plan 055) — keep the write path shape-compatible.

## Git workflow

- Branch: `advisor/051-wrapped-batch-inserts`
- Conventional commits, e.g. `perf(server): batch wrapped child inserts`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Batch replaceTopMedia into one multi-row INSERT

1. Keep the leading `DELETE` as-is.
2. Normalize all entries into a row array first (same logic as today,
   including the `if (!activityDate) continue`-equivalent filtering — for
   top-media there is no skip, keep every entry).
3. If the array is empty, return after the DELETE (no INSERT).
4. Build one `INSERT INTO wrapped_top_media (...) SELECT ... FROM
   jsonb_to_recordset($2)` (or `unnest` arrays — pick whichever keeps the
   per-row title-fallback subselect expressible; `jsonb_to_recordset` with a
   single `$2::jsonb` param plus `$1 = reportId` is usually cleanest).
   The title expression per row stays:
   `COALESCE(NULLIF(title, ''), (SELECT title FROM media_assets WHERE id = media_id), fallback_title)`.
5. Verify row-for-row equivalence: same columns, same order semantics (rank
   comes from the payload, not insert order — confirm).

**Verify**: `npm run test:server` → wrapped tests pass.

### Step 2: Batch replaceTimeline into one multi-row INSERT

Same treatment for `replaceTimeline`: filter invalid dates first, early-return
on empty, single INSERT of all days.

**Verify**: `npm run test:server` → all pass.

### Step 3: Add equivalence tests

Add tests saving a report with multiple top-media items (including blank
titles exercising the fallback, and missing media ids exercising
`Media #<id>`) and multi-day timelines, then reading back via the existing
get path and asserting identical contents. Include an empty-arrays save
(DELETE-only path) and an invalid-date timeline entry (skipped).

**Verify**: `npm run test:server` → all pass including new tests.

## Test plan

- Equivalence tests per step 3 in the wrapped route test file.
- Full suite green; lint clean.

## Done criteria

- [ ] `npm run test:server` exits 0 with new equivalence tests passing
- [ ] `replaceTopMedia` and `replaceTimeline` each issue at most 2 statements
      (DELETE + one INSERT); no `await client.query(INSERT` inside a loop
- [ ] Read-back contents byte-equivalent to the old per-row path
- [ ] `npm run lint --workspace=server` exits 0
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Excerpts don't match (drift).
- The title-fallback subselect cannot be preserved per-row in a set-based
  INSERT without changing semantics — stop and report.
- Verification fails twice after reasonable attempts.

## Maintenance notes

- Plan 055 (annual Wrapped) reuses these writers for the one-year period —
  timeline arrays get ~12x longer there, which is exactly why batching lands first.
- If a future partial-update (upsert) replaces DELETE+INSERT, revisit this.
