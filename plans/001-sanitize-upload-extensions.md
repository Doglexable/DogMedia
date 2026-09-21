# Plan 001: Sanitize Uploaded Media Extensions to Prevent Path Traversal

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1cb3b29..HEAD -- server/src/routes/media.js server/src/routes/media.test.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `1cb3b29`, 2026-09-21

## Why this matters

In `server/src/routes/media.js`, the file extension helper `extFromFilename` extracts the extension by splitting on dots and taking the last segment without stripping path separators (`/`, `\`) or dot-dot (`..`) sequences. When media or replacement files are uploaded, the destination file name is constructed as `${mediaId}.${ext}` and joined with `categoryDir`. An attacker supplying a file name like `payload.jpg/../../evil.js` can write arbitrary files outside the category directory or outside `DATA_DIR`.

Fixing this closes the path traversal vulnerability and guarantees that all stored media files remain strictly contained within their designated category directory.

## Current state

- `server/src/routes/media.js` — media routing and chunk upload handling (lines 117–120, 356–357, 443–447)
- Excerpt from `server/src/routes/media.js:117-120`:
```javascript
function extFromFilename(filename, fallback = "bin") {
  const parts = String(filename || "").split(".");
  return (parts.length > 1 ? parts.pop() : fallback).toLowerCase();
}
```
- Excerpt from `server/src/routes/media.js:356-358`:
```javascript
  const storedName = `${mediaId}.${ext}`;
  const filePath = join(categoryDir, storedName);
```

- Repo conventions: Fastify ESM with Node.js built-ins (`node:path`, `node:fs/promises`). Error handling returns typed HTTP status codes and JSON objects.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Tests     | `npm run test:server`    | exit 0, all pass    |
| Lint      | `npm run lint --workspace=server` | exit 0     |

## Scope

**In scope**:
- `server/src/routes/media.js`
- `server/src/routes/media.test.js`

**Out of scope**:
- Database schema changes (file_path column remains unchanged).
- Client upload UI (`web/src/pages/Admin.jsx`).

## Git workflow

- Branch: `advisor/001-sanitize-upload-extensions`
- Commit message: `fix(server): sanitize uploaded media file extensions against path traversal`

## Steps

### Step 1: Sanitize extension in `extFromFilename` and validate resolved paths

In `server/src/routes/media.js`:
1. Update `extFromFilename(filename, fallback = "bin")`:
   - Strip any path traversal sequences (`/`, `\`, null bytes).
   - Only allow alphanumeric characters: `replace(/[^a-z0-9]/gi, "").toLowerCase()`.
   - If the resulting extension is empty, return `fallback.toLowerCase()`.
2. In `persistMediaUpload` and `replaceMediaFiles`, ensure that `resolve(categoryDir, storedName).startsWith(resolve(categoryDir))` to guarantee boundary containment.

**Verify**: `npm run test:server` → all existing tests pass.

### Step 2: Add unit and integration tests for path traversal prevention

In `server/src/routes/media.test.js`:
Add unit tests for `extFromFilename`:
- Input `"song.mp3"` → returns `"mp3"`
- Input `"exploit.jpg/../../evil.sh"` → strips slashes and traversal sequences, returning `"sh"` or clean alphanumeric token.
- Input `"malicious..//\\"` → returns fallback `"bin"`.

**Verify**: `npm run test:server` → all tests pass.

## Test plan

- Test `extFromFilename` with regular filenames, multi-dot extensions, and traversal strings containing `/`, `\`, and `..`.
- Run full server test suite: `npm run test:server`.

## Done criteria

- [ ] `npm run lint --workspace=server` exits 0.
- [ ] `npm run test:server` exits 0 with new test cases covering traversal patterns.
- [ ] No files outside `server/src/routes/media.js` and `server/src/routes/media.test.js` are modified.

## STOP conditions

- If `extFromFilename` is used for non-media types requiring special punctuation, stop and report.
- If existing integration tests expect specific raw extension preservation, stop and report.

## Maintenance notes

- Any future upload handlers (e.g. mobile release APK uploads in `mobile-release.js`) should use the same sanitization helper.
