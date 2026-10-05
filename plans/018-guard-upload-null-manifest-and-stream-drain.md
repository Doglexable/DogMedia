# Plan 018: Guard Chunk Upload Null Manifest and Drain Unconsumed Streams

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 50f1f36..HEAD -- server/src/routes/media.js server/src/routes/mobile-release.js server/src/routes/mobile-release.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/015-fix-site-footer-rgb-tokens.md
- **Category**: bug
- **Planned at**: commit `50f1f36`, 2026-09-22

## Why this matters

In chunked media uploads, if an upload session's `manifest.json` does not define `file` (e.g. metadata-only sessions or malformed upload states), `manifest.file.totalChunks` throws an unhandled `TypeError`. Because the chunk was already written to temporary disk at line 892, this crash bypasses `cleanupUploads(chunkUpload)` at line 905, leaking orphaned chunks in the temporary directory. In `server/src/routes/mobile-release.js`, when a chunk fails index validation, the route handler returns HTTP 400 without resuming or draining `part.file`. In `@fastify/multipart`, returning without consuming a file stream leaves the underlying connection hanging until client or socket timeout. Adding safe navigation and explicitly draining the stream fixes both issues.

## Current state

The relevant files:
- `server/src/routes/media.js` — chunked media upload route handler (`POST /uploads/:uploadId/chunks`).
- `server/src/routes/mobile-release.js` — Android APK release chunk upload handler (`POST /uploads/:uploadId/chunks`).
- `server/src/routes/mobile-release.test.js` — test suite for mobile release endpoints.

Current-state excerpts:
`server/src/routes/media.js:900-907`:
```javascript
    const kind = fields.kind === "thumbnail" ? "thumbnail" : "file";
    const index = Number.parseInt(fields.index, 10);
    const expectedChunks = kind === "thumbnail" ? manifest.thumbnail?.totalChunks : manifest.file.totalChunks;

    if (!chunkUpload || !Number.isInteger(index) || index < 0 || !expectedChunks || index >= expectedChunks) {
      await cleanupUploads(chunkUpload);
      return reply.code(400).send({ error: "Chunk and valid index are required" });
    }
```

`server/src/routes/mobile-release.js:80-86`:
```javascript
    const part = await request.file({ limits: { fileSize: CHUNK_SIZE + 1024 } });
    const index = Number.parseInt(part?.fields?.index?.value, 10);
    if (!part || !Number.isInteger(index) || index < 0 || index >= manifest.totalChunks) {
      return reply.code(400).send({ error: "Invalid upload chunk" });
    }
    await pipeline(part.file, createWriteStream(join(uploadDir, `${index}.part`)));
```

Repo conventions:
- In Fastify multipart handling, non-persisted files must call `part.file.resume()` (see `server/src/routes/media.js:894`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server tests | `npm run test:server` | all pass |
| Mobile release test only | `npm run test:server -- mobile-release.test.js` | all pass |
| Media test only | `npm run test:server -- media.test.js` | all pass |
| Server lint | `npm run lint --workspace=server` | exit 0 |

## Scope

**In scope**:
- `server/src/routes/media.js` — use optional chaining `manifest.file?.totalChunks` and clean up chunk on invalid manifest.
- `server/src/routes/mobile-release.js` — call `part?.file?.resume()` when chunk validation fails.
- `server/src/routes/mobile-release.test.js` — add test verifying invalid chunk index drains stream and returns 400 promptly.

**Out of scope**:
- `server/src/upload-cleanup.js` — scheduled temporary folder sweeps.
- Re-architecting chunked assembly algorithms.

## Git workflow

- Branch: `advisor/018-guard-upload-null-manifest-and-stream-drain`
- Commit style: `fix(server): guard chunk upload null manifest and drain unconsumed multipart streams`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add safe optional chaining to manifest checks in `server/src/routes/media.js`

In `server/src/routes/media.js:902`, change:
```javascript
const expectedChunks = kind === "thumbnail" ? manifest.thumbnail?.totalChunks : manifest.file.totalChunks;
```
to:
```javascript
const expectedChunks = kind === "thumbnail" ? manifest.thumbnail?.totalChunks : manifest.file?.totalChunks;
```
Ensure that if `!expectedChunks`, the condition at line 904 evaluates to true, triggering `await cleanupUploads(chunkUpload)` and returning 400 Bad Request instead of throwing an unhandled TypeError.

### Step 2: Drain stream on validation failure in `server/src/routes/mobile-release.js`

In `server/src/routes/mobile-release.js:82-85`, update the validation block to drain the file stream before returning 400:
```javascript
    const part = await request.file({ limits: { fileSize: CHUNK_SIZE + 1024 } });
    const index = Number.parseInt(part?.fields?.index?.value, 10);
    if (!part || !Number.isInteger(index) || index < 0 || index >= manifest.totalChunks) {
      if (part?.file) {
        part.file.resume();
      }
      return reply.code(400).send({ error: "Invalid upload chunk" });
    }
```

### Step 3: Add test in `server/src/routes/mobile-release.test.js`

In `server/src/routes/mobile-release.test.js`, add a test case verifying that sending an invalid chunk index (e.g. index 999 when manifest has 2 chunks) returns 400 immediately and resolves without hanging:

```javascript
  it("drains unconsumed stream and returns 400 on invalid chunk index", async () => {
    const app = await buildApp();
    const initRes = await app.inject({
      method: "POST",
      url: "/api/mobile-release/uploads",
      payload: { versionName: "1.0.0", versionCode: 10, totalChunks: 2, totalBytes: 1024 },
    });
    const { uploadId } = JSON.parse(initRes.body);

    const chunk = multipartChunk(999, Buffer.alloc(100));
    const chunkRes = await app.inject({
      method: "POST",
      url: `/api/mobile-release/uploads/${uploadId}/chunks`,
      ...chunk,
    });
    expect(chunkRes.statusCode).toBe(400);
    expect(JSON.parse(chunkRes.body).error).toBe("Invalid upload chunk");
  });
```

**Verify**: `npm run test:server -- mobile-release.test.js` → all pass.

## Test plan

- Verify that chunk upload with missing `manifest.file` returns 400 and does not leak chunk files.
- Verify that invalid chunk index in mobile release upload returns 400 immediately without connection stalls.
- Run `npm run test:server` and verify all tests pass.

## Done criteria

- [ ] `manifest.file?.totalChunks` uses optional chaining in `media.js`
- [ ] `part.file.resume()` is called on validation error in `mobile-release.js`
- [ ] `npm run test:server -- mobile-release.test.js` exits 0
- [ ] `npm run test:server` exits 0 across all 26 test files
- [ ] `npm run lint --workspace=server` exits 0

## STOP conditions

- If `@fastify/multipart` throws when calling `resume()` on an already ended stream.

## Maintenance notes

- Any route parsing multipart file streams must ensure `part.file.resume()` is called on every early return branch to prevent socket connection hangs.
