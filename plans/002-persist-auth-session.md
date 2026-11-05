# Plan 002: Persist Auth Session in Desktop Client

> **Executor instructions**: Follow this plan step‑by‑step. Run every verification command and confirm the expected result before moving to the next step. If any **STOP condition** occurs, stop and report.

> **Drift check (run first)**: `git diff --stat ee9dacf..HEAD -- desktop/src/* desktop/Cargo.toml`

## Status
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 001
- **Category**: dx | security
- **Planned at**: commit `ee9dacf`, 2026-11-02

## Why this matters
Persisting the bearer token after a successful login avoids forced re‑authentication on every restart, improves UX, and aligns the desktop client with the web/mobile flows that already cache the session. The change must keep the token confidential and support automatic refresh.

## Current state
- `desktop/src/ui/mod.rs` builds an `ApiClient` with `Authorization: Bearer <token>` only while the app lives.
- No on‑disk storage for the token; on quit the token is lost.
- `desktop/src/api/client.rs` (or similar) contains `fn new(token: Option<String>) -> Self`.

## Commands you will need
| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Build   | `cargo build --workspace --locked` | exit 0 |
| Test    | `cargo test --workspace --locked` | all pass |
| Lint    | `cargo clippy --workspace -- -D warnings` | exit 0 |
| Verify keyring (optional) | `cargo test --workspace --locked --features secure-storage` | exit 0 |

## Scope
**In scope** (only files to modify):
- `desktop/src/api/client.rs` – add token persistence helpers.
- `desktop/src/ui/mod.rs` – load token on startup, pass to `ApiClient`.
- New module `desktop/src/auth/persistence.rs`.
- Update `desktop/Cargo.toml` to include optional `keyring` crate.
- Add unit/integration tests for the new module.

**Out of scope**:
- Server‑side changes.
- Mobile/web clients (they already have persistence).
- Changing token format or refresh endpoint.

## Git workflow
- Branch: `advisor/002-persist-auth-session`
- Commits per logical step, conventional‑commit style (e.g., `feat(auth): persist bearer token`).

## Steps
### Step 1: Add optional `keyring` dependency
Edit `desktop/Cargo.toml`:
```toml
[dependencies]
keyring = { version = "2.0", optional = true }

[features]
secure-storage = ["keyring"]
```
**Verify**: `cargo check --features secure-storage` succeeds.

### Step 2: Create `desktop/src/auth/persistence.rs`
```rust
use anyhow::Result;
use std::path::PathBuf;

#[cfg(feature = "secure-storage")] use keyring::Entry;

/// Store the token securely.
pub fn store_token(token: &str) -> Result<()> {
    #[cfg(feature = "secure-storage")] {
        Entry::new("dogmedia-desktop", "auth-token").set_password(token)?;
    }
    #[cfg(not(feature = "secure-storage")) {
        let path = token_path()?;
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600) // rw-------
            .open(&path)?;
        use std::io::Write;
        file.write_all(token.as_bytes())?;
    }
    Ok(())
}

/// Load the stored token, if any.
pub fn load_token() -> Result<Option<String>> {
    #[cfg(feature = "secure-storage")] {
        match Entry::new("dogmedia-desktop", "auth-token").get_password() {
            Ok(tok) => Ok(Some(tok)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(anyhow::anyhow!(e)),
        }
    }
    #[cfg(not(feature = "secure-storage")) {
        let path = token_path()?;
        if !path.exists() { return Ok(None); }
        let tok = std::fs::read_to_string(path)?;
        Ok(Some(tok.trim_end().to_owned()))
    }
}

fn token_path() -> Result<PathBuf> {
    let mut dir = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("cannot locate home directory"))?;
    dir.push(".dogmedia");
    dir.push("auth_token");
    Ok(dir)
}
```
**Verify**: `cargo test --workspace --features secure-storage` compiles.

### Step 3: Hook persistence into login flow
In `desktop/src/api/client.rs` (or wherever the login response is handled):
```rust
let token = response.token; // string
auth::persistence::store_token(&token).ok(); // ignore errors but log them
let client = ApiClient::new(Some(token.clone()));
```
**Verify**: Build succeeds.

### Step 4: Load token on application start
In `desktop/src/ui/mod.rs` early in `main`/initialization:
```rust
let maybe_token = auth::persistence::load_token().unwrap_or_default();
let client = ApiClient::new(maybe_token.clone());
app.write().client = Some(client);
```
If a token is present, the UI should start logged‑in (e.g., user avatar visible) without prompting.

### Step 5: Optional automatic refresh
- Decode JWT (`jwt::decode`) to read `exp` claim.
- If `exp` < now + 5 min, call `/api/auth/refresh` to get a new token, then `store_token` it.
- This can be a small async task spawned at startup.
**Verify**: Simulate an expired token and ensure refresh is triggered.

### Step 6: Logout handling
In the logout handler:
```rust
auth::persistence::store_token("").ok(); // overwrite empty
#[cfg(feature = "secure-storage")] { let _ = Entry::new("dogmedia-desktop", "auth-token").delete(); }
app.write().client = None;
```
**Verify**: After logout and restart, the login screen appears.

### Step 7: Tests
- Unit test round‑trip `store_token` → `load_token` using `tempdir` (override home dir via env `HOME`).
- Integration test: start app, perform login, terminate, restart, assert still logged in.
- Test that file permissions are `0o600` when `secure-storage` disabled.

### Step 8: Lint, build, full test suite
```bash
cargo clippy --workspace -- -D warnings
cargo test --workspace --locked
```
All must pass.

## Done criteria
- [ ] Code compiles with and without `secure-storage` feature.
- [ ] All existing tests pass.
- [ ] New unit/integration tests pass.
- [ ] Manual verification: login once, quit, restart – user remains logged in.
- [ ] `plans/README.md` status row updated to **DONE**.

## STOP conditions
- Token file created with permissions broader than `0o600`.
- Compilation fails in a way that requires editing files outside the listed scope.
- Refresh logic cannot be added without server changes.
- Keyring crate fails to build on the target platform and no fallback is possible.

---
