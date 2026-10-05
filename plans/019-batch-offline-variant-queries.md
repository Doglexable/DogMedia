# Plan 019: Batch Media Variant and Music Reel Queries to Eliminate N+1 Database Calls

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 50f1f36..HEAD -- server/src/routes/offline.js server/src/routes/music-shares.js server/src/offline.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/015-fix-site-footer-rgb-tokens.md
- **Category**: perf
- **Planned at**: commit `50f1f36`, 2026-09-22

## Why this matters

The mobile offline synchronization system exposes `/api/offline/manifest` and `/api/offline/validate`. When generating manifest items or validating batches of up to 500 tracks, `server/src/routes/offline.js` invokes `resolveQualityFile` individually for every audio row. Each call issues a separate SQL query against `media_encoding_variants`, creating up to 500 concurrent roundtrips to PostgreSQL on a single HTTP request. Similarly, `server/src/routes/music-shares.js` inserts reel items one-by-one in a JavaScript loop inside a transaction. Loading variants in a single `WHERE media_id = ANY($1::int[])` query and batching reel item inserts into a single SQL statement eliminates these N+1 query bottlenecks and prevents connection pool exhaustion.

## Current state

The relevant files:
- `server/src/routes/offline.js` — offline manifest and batch validation routes.
- `server/src/routes/music-shares.js` — music share reel creation route.
- `server/src/offline.test.js` — unit tests for offline helpers.

Current-state excerpts:
`server/src/routes/offline.js:91-101`:
```javascript
async function resolveQualityFile(pg, row, requestedQuality) {
  if (requestedQuality === "ori") return { path: row.file_path, mimeType: row.mime_type, quality: "ori" };
  const { rows } = await pg.query(
    `SELECT quality, file_path, mime_type FROM media_encoding_variants
     WHERE media_id = $1 AND source_version = $2 AND status = 'ready'`,
    [row.id, row.source_version]
  );
  const quality = selectActualQuality(requestedQuality, rows.map((item) => item.quality));
  const variant = rows.find((item) => item.quality === quality);
  return variant ? { path: variant.file_path, mimeType: variant.mime_type, quality } : { path: row.file_path, mimeType: row.mime_type, quality: "ori" };
}
```

`server/src/routes/offline.js:193-200`:
```javascript
    await Promise.all(requested.map(async (requestItem) => {
      const mediaId = normalizeOfflineMediaId(requestItem?.mediaId);
      const row = rowById.get(mediaId);
      if (!row) return;
      const quality = normalizeRequestedQuality(requestItem?.quality, { defaultQuality: "ori" }) || "ori";
      const items = await manifestItems([row], dataDir, fastify.pg, quality);
      if (items[0]) accessible.set(`${mediaId}:${quality}`, items[0]);
    }));
```

`server/src/routes/music-shares.js:143-149`:
```javascript
        await client.query(
          `INSERT INTO music_share_reel_items
             (reel_id, position, media_id, source_version, clip_start, title, artists)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [reel.id, Number(item.position), item.id, item.source_version, clipStart, item.title, item.artists]
        );
```

Repo conventions:
- PostgreSQL array parameters use `= ANY($1::int[])` for batch lookups.
- Multi-row inserts use parameterized placeholders or unnest arrays.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server tests | `npm run test:server` | all pass |
| Offline tests only | `npm run test:server -- offline` | all pass |
| Server lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:
- `server/src/routes/offline.js` — batch variant resolution in `manifestItems` and `POST /validate`.
- `server/src/routes/music-shares.js` — multi-row batch insert for reel items.
- `server/src/offline.test.js` — add tests covering batch variant resolution.

**Out of scope**:
- `server/src/media-quality.js` — resolution selection logic.
- Mobile offline sync engine in `mobile/src/`.

## Git workflow

- Branch: `advisor/019-batch-offline-variant-queries`
- Commit style: `perf(server): batch media variant and reel item database queries`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Batch variant lookups in `server/src/routes/offline.js`

In `server/src/routes/offline.js`:
1. Create a helper `fetchVariantsBatch(pg, mediaIds)`:
   ```javascript
   async function fetchVariantsBatch(pg, mediaIds) {
     const ids = [...new Set(mediaIds)].filter((id) => Number.isInteger(id) && id > 0);
     if (!ids.length) return new Map();
     const { rows } = await pg.query(
       `SELECT media_id, source_version, quality, file_path, mime_type
        FROM media_encoding_variants
        WHERE media_id = ANY($1::int[]) AND status = 'ready'`,
       [ids]
     );
     const variantsByMedia = new Map();
     for (const row of rows) {
       const key = `${row.media_id}:${row.source_version}`;
       if (!variantsByMedia.has(key)) variantsByMedia.set(key, []);
       variantsByMedia.get(key).push(row);
     }
     return variantsByMedia;
   }
   ```
2. Update `resolveQualityFile(pg, row, requestedQuality, preloadedVariants = null)`:
   If `preloadedVariants` has entries for `${row.id}:${row.source_version}`, use those rows directly instead of executing `pg.query`.
3. In `manifestItems(rows, dataDir, pg, requestedQuality = "ori")`, call `const variantsMap = await fetchVariantsBatch(pg, rows.map((r) => Number(r.id)))` once before starting the worker loop, and pass `variantsMap` to `resolveQualityFile`.
4. In `POST /validate`, batch load all rows once rather than calling `manifestItems([row], ...)` inside `Promise.all(requested.map(...))`.

### Step 2: Batch reel item insertions in `server/src/routes/music-shares.js`

In `server/src/routes/music-shares.js`, replace the loop of individual `client.query("INSERT INTO music_share_reel_items ...")` statements with a single multi-row `INSERT` constructing `VALUES ($1, $2, ...), ($8, $9, ...)` or using PostgreSQL `unnest`:

```javascript
    const reelItems = [];
    for (const item of items) {
      const requestedClipStart = item.clip_start == null ? null : Math.max(0, Math.floor(Number(item.clip_start)));
      const clipStart = calculateClipStart(
        requestedClipStart == null ? lyricLeadInStart(item.lyrics_segments) : requestedClipStart,
        item.duration
      );
      reelItems.push([reel.id, Number(item.position), item.id, item.source_version, clipStart, item.title, item.artists]);
    }

    if (reelItems.length > 0) {
      const valuePlaceholders = reelItems.map((_, i) => {
        const offset = i * 7;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
      }).join(", ");
      await client.query(
        `INSERT INTO music_share_reel_items
           (reel_id, position, media_id, source_version, clip_start, title, artists)
         VALUES ${valuePlaceholders}`,
        reelItems.flat()
      );
    }
```

### Step 3: Run verification tests

**Verify**: `npm run test:server -- offline` → all pass.
**Verify**: `npm run test:server` → all pass.

## Test plan

- Test that manifest generation with multiple tracks queries variants in a single batch.
- Test that music reel creation inserts all tracks in a single query.
- Verify all existing server tests continue to pass.

## Done criteria

- [ ] `manifestItems` executes 1 query for all variant lookups regardless of row count
- [ ] `music_share_reel_items` are inserted in a single query statement
- [ ] `npm run test:server` exits 0
- [ ] `npm run lint --workspace=server` exits 0

## STOP conditions

- If query parameter length in multi-row insert exceeds PostgreSQL's 65,535 limit (music share reels have maximum 50 tracks, totaling 350 parameters, well within limit).

## Maintenance notes

- Any new offline catalog endpoints must pass preloaded variant maps to avoid regressing back to per-item queries.
