# Plan 001: Granular Signal Updates

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If any **STOP condition** occurs, stop and report.

> **Drift check (run first)**: `git diff --stat ee9dacf..HEAD -- desktop/src/playback/coordinator.rs desktop/src/ui/mod.rs`

## Status
- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `ee9dacf`, 2026-11-02

## Why this matters
The current WebSocket lease handler writes the entire `NativeApp` signal on every broadcast, causing Dioxus to diff the whole UI tree each second. This allocates ~200 MiB of heap memory due to allocator churn. Updating only the fields needed for the conflict UI eliminates the costly full re‑render.

## Current state
- `desktop/src/ui/mod.rs:830‑852` – socket lease handling, calls `app.write().coordinator.observe_remote` which mutates the whole snapshot.
- `desktop/src/playback/coordinator.rs:213‑244` – `observe_remote` updates many fields (sequence, media, position, status, etc.) and marks the session unavailable.
- The UI only needs `media`, `holder`, and `session_unavailable` for the `SessionConflictCard`.

## Commands you will need
| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build   | `cargo build --workspace --locked` | exit 0 |
| Test    | `cargo test --workspace --locked` | all pass |
| Lint    | `cargo clippy --workspace -- -D warnings` | exit 0 |

## Scope
**In scope** (only files to modify):
- `desktop/src/playback/coordinator.rs`
- `desktop/src/ui/mod.rs`

**Out of scope**:
- Any other UI components, playback engine, or unrelated crates.

## Git workflow
- Branch: `advisor/001-granular-signal-updates`
- Commit per logical step, conventional‑commit style.

## Steps
### Step 1: Add `update_remote_state` method
Create a new public method on `Coordinator` that only updates the three fields needed by the conflict card.
```rust
impl Coordinator {
    /// Update only the remote‑observer fields used by SessionConflictCard.
    pub fn update_remote_state(&mut self, media: Media, holder: SessionHolder) {
        self.snapshot.media = Some(media);
        self.snapshot.holder = Some(holder);
        self.snapshot.session_unavailable = true;
        // Do NOT touch sequence, position, duration, status, etc.
    }
}
```
**Verify**: `grep -n "update_remote_state" -R desktop/src/playback` → file exists.

### Step 2: Replace `observe_remote` calls in the socket handler
Edit `desktop/src/ui/mod.rs` around line 839‑852:
- Remove the call to `app.write().coordinator.observe_remote(media, holder);`
- Insert `app.write().coordinator.update_remote_state(media, holder);`
- Keep the existing `ensure_artwork` call unchanged.
**Verify**: Compile with `cargo check` – no references to `observe_remote` in this file.

### Step 3: Adjust any other callers
Search the repo for `observe_remote(` and replace with `update_remote_state(` where the full snapshot update is not required (e.g., in `apply_remote_holder`). If the full update is needed elsewhere, leave the original call untouched.
**Verify**: `git grep "observe_remote("` returns only definitions or intentional usages.

### Step 4: Run tests and lint
```bash
cargo test --workspace --locked
cargo clippy --workspace -- -D warnings
```
All should pass.

### Step 5: Benchmark memory impact
Run the existing memory‑watch script with the new binary and record RSS before and after opening the conflict card.
```bash
./target/debug/desktop -- --memory-watch >/tmp/mem_before.txt
# trigger conflict UI manually
./target/debug/desktop -- --memory-watch >/tmp/mem_after.txt
```
Ensure the delta is < 50 MiB.

## Done criteria
- [ ] `cargo build` succeeds.
- [ ] All tests pass.
- [ ] No file outside the in‑scope list is modified.
- [ ] Memory increase measured < 50 MiB when the conflict card appears.
- [ ] `plans/README.md` status row updated to **DONE**.

## STOP conditions
- The code at the locations above no longer matches the excerpts (drift).
- Compilation fails after a step and cannot be fixed without touching out‑of‑scope files.
- The verification command fails twice after reasonable fixes.

---
