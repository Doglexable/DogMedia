# Plan 066: Profile Modal and Navigation Integration (Sidebar & Bottom Bar)

> **Context**: Web client user profile modal providing user account details, username/password updates, cancel button, and logout button at the very bottom, accessible from both desktop/tablet sidebar and mobile bottom navigation.
>
> **Status**: COMPLETED / READY FOR REVIEW

## Status & Metadata

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: feature / auth / ui
- **Planned & Implemented at**: 2026-10-21

---

## 1. Objectives

1. **User Profile Modal**:
   - Display active user summary (avatar, username, role/access tier).
   - Allow user to edit username (3–40 characters, letters, numbers, dots, underscores, hyphens).
   - Allow user to change password (minimum 12 characters, requires current password verification).
   - Provide primary action: **Update user** button.
   - Provide secondary action: **Batal** (cancel / dismiss) button.
   - Provide distinct danger/bottom action: **Log out** button at the very bottom of the modal.

2. **Navigation Triggers**:
   - **Desktop / Tablet Sidebar**: Interactive profile trigger card in `global-sidebar-footer` showing user avatar (small variant `_s_.webp`), username, and tier/role, opening the profile modal on click.
   - **Mobile Bottom Navigation Bar**: Dedicated `Profile` tab with avatar (small variant `_s_.webp`) or `faCircleUser` fallback in `mobile-nav-bar`, opening the profile modal on tap.

3. **User Profile Pictures & Attribution**:
   - Avatars served from `data/media/profile-picture` (20 unique Expedition 33 emote characters).
   - High-resolution preview in modal user card: `_l_.webp` variant via `profilePictureUrl(avatar, "l")`.
   - Compact navigation preview in sidebar footer and bottom bar: `_s_.webp` variant via `profilePictureUrl(avatar, "s")`.
   - Collapsible sections in `ProfileModal` ("Profile Picture & Credits" and "Change Password") for compact, clean presentation.
   - Credits attribution for Expedition 33 emotes creators (Sarah Leuver / comickergirl, Bugyakis, IrunoArt) with raw `CREDITS.txt` viewer.

4. **Backend API Support**:
   - `GET /api/auth/profile`: Retrieves current authenticated user profile (`{ id, username, access_tier, profile_picture, created_at }`).
   - `PUT /api/auth/profile`: Validates inputs, updates `profile_picture`, checks current password if password change is requested, updates database, and updates Redis session.
   - `GET /api/profile-pictures`: Lists available avatars with filenames, base names, and available variants (`s`, `l`, `m`, `f`).
   - `GET /api/profile-pictures/:name`: Serves avatar webp files with size negotiation (`?size=l` or `?size=s`), default fallback to `fine`, and path-traversal prevention.
   - `GET /api/profile-pictures/credits`: Serves the `CREDITS.txt` file contents.

---

## 2. Implementation Summary

### A. Backend Endpoints (`server/src/plugins/auth.js`)
- **`GET /api/auth/profile`**:
  - Gated by active session check (`requireActiveSession`).
  - Returns authenticated user details from PostgreSQL `users` table.
- **`PUT /api/auth/profile`**:
  - Validates username regex `^[a-zA-Z0-9._-]{3,40}$`.
  - Checks if new username conflicts with another registered account.
  - If password is provided: validates minimum length 12, verifies `currentPassword` with `scrypt` against current user password hash.
  - Updates PostgreSQL `users` table and syncs active Redis session user payload.
  - Returns updated user record.

### B. Unit & Integration Tests (`server/src/plugins/auth.test.js`)
- Added mock update handling for PostgreSQL in `createApp()`.
- Added test suite for `GET /api/auth/profile` and `PUT /api/auth/profile` verifying:
  - Username update with session sync.
  - Password update with current password validation.
  - Rejection of invalid username or incorrect current password.

### C. Client Access Context (`web/src/App.jsx`)
- Exposed `updateUser(user)` in `AccessContext.Provider` so profile updates immediately update global state across all components without needing full page reload.

### D. Profile Modal Component (`web/src/components/profile-modal.jsx`)
- Built accessible dialog with backdrop click and `Escape` key handlers.
- Header with title and close button.
- User badge card displaying avatar and role badge.
- Form inputs for Username, New Password, and Current Password with inline validation and help text.
- Alerts for error (`profile-modal-alert-error`) and success (`profile-modal-alert-success`).
- Actions:
  - `<button type="submit">Update user</button>`
  - `<button type="button" onClick={onClose}>Batal</button>`
- Bottom Section:
  - Divider.
  - `<button type="button" className="profile-modal-logout-btn" onClick={handleLogout}>Log out</button>`.

### E. Navigation Shell Integration (`web/src/components/library-shell.jsx`)
- Added `profileOpen` state in `GlobalSidebar`.
- In `global-sidebar-footer`: Replaced static badge and raw logout button with `.global-sidebar-profile-btn` card button that opens the modal.
- In `mobile-nav-bar`: Added `<BottomNavTab icon={faCircleUser} active={profileOpen} onClick={...}>Profile</BottomNavTab>`.
- Rendered `<ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} access={access} />`.

### F. Mobile Client Account Screen Integration (`mobile/src/App.jsx`)
- Updated `AccountScreen` to feature the complete user profile management suite:
  - User summary card with avatar and tier badge (`Administrator` vs `Standard User`).
  - Form fields for Username, New Password, and Current Password.
  - Action buttons: **Update user** (calling `PUT /api/auth/profile`) and **Batal** (reverting changes).
  - Bottom danger button: **Log out** (calling `access.logout()`).
  - Added `updateUser` to `AccessContext.Provider` so session updates propagate immediately without requiring app restart.

### G. Styling (`web/src/theme.css`)
- Styled `.global-sidebar-profile-btn`, avatar, info, username, and tier.
- Styled `.profile-modal-overlay`, `.profile-modal`, `.profile-modal-header`, `.profile-modal-body`, `.profile-modal-user-card`, `.profile-modal-input`, `.profile-modal-btn-primary`, `.profile-modal-btn-secondary`, and `.profile-modal-logout-btn`.

---

## 3. Verification & Acceptance

1. **Server Unit Tests**:
   - `npm run test:server` -> **32 files passed, 313 tests passed (100%)** (including [server/src/routes/profile-pictures.test.js](file:///home/mann/Development/private-file-stream/server/src/routes/profile-pictures.test.js) and [server/src/plugins/auth.test.js](file:///home/mann/Development/private-file-stream/server/src/plugins/auth.test.js)).
2. **Web Unit Tests**:
   - `npm run test:web` -> **43 files passed, 339 tests passed (100%)** (including [web/src/components/profile-modal.test.jsx](file:///home/mann/Development/private-file-stream/web/src/components/profile-modal.test.jsx) and [web/src/components/library-shell.test.jsx](file:///home/mann/Development/private-file-stream/web/src/components/library-shell.test.jsx)).
3. **Mobile Unit Tests**:
   - `npm run test:mobile` -> **14 files passed, 143 tests passed (100%)**.
4. **Lint & Build**:
   - `npm run lint` -> **Clean across all workspaces**.
   - `npm run build` -> **Vite production build succeeded**.
   - `npm run test:mobile` -> **14 files passed, 143 tests passed (100%)**.
4. **Desktop Native Tests**:
   - `cargo test --manifest-path desktop/Cargo.toml` -> **107 tests passed (100%)**.
5. **Linter**:
   - `npm run lint` -> **Clean (0 errors, 0 warnings across server, web, and mobile)**.
6. **Production Build**:
   - `npm run build` -> **Vite production build succeeds cleanly in ~1s**.

---

## 4. Modified & New Files

- `server/src/plugins/auth.js` (profile endpoints added)
- `server/src/plugins/auth.test.js` (profile unit tests added)
- `web/src/App.jsx` (`updateUser` added to AccessContext)
- `web/src/components/profile-modal.jsx` (profile modal component)
- `web/src/components/profile-modal.test.jsx` (modal component unit tests)
- `web/src/components/library-shell.jsx` (sidebar & bottom bar wired)
- `web/src/theme.css` (modal and trigger styling)
- `mobile/src/App.jsx` (mobile Account/Profile screen upgraded to full profile manager)
- `plans/066-profile-modal-and-navigation-integration.md` (plan documentation)
- `plans/README.md` (index updated)
