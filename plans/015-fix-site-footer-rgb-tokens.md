# Plan 015: Replace Hardcoded RGB Fallbacks in Site Footer with Design Tokens

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 50f1f36..HEAD -- web/src/components/site-footer.css web/src/components/site-footer.test.jsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `50f1f36`, 2026-09-22

## Why this matters

The unified monorepo test script `npm run test` is currently broken across `main` because `web/src/components/site-footer.test.jsx` fails with `AssertionError: expected [ 'rgb(0 0 0 / 18%)', ... ] to be null`. The test strictly asserts that `site-footer.css` contains zero hardcoded hex, rgb, or hsl colors and relies entirely on theme design tokens. Because `package.json` chains tests with `&&`, this single failure halts test verification before mobile tests can run. Fixing these fallback colors restores a clean, one-command verification baseline across the entire repository.

## Current state

The relevant files:
- `web/src/components/site-footer.css` — editorial footer stylesheet with CSS custom property design tokens.
- `web/src/components/site-footer.test.jsx` — vitest suite verifying token conformance and structure.

Current-state excerpts:
`web/src/components/site-footer.css:238-242`:
```css
.site-footer-util-item:hover {
  color: var(--text);
  border-color: var(--card-border-strong, rgb(0 0 0 / 18%));
  background: var(--hover-fill, rgb(0 0 0 / 5%));
}
```

`web/src/components/site-footer.css:308-312`:
```css
.site-footer-social-link:hover {
  color: var(--text);
  border-color: var(--card-border-strong, rgb(0 0 0 / 18%));
  background: var(--hover-fill, rgb(0 0 0 / 5%));
}
```

`web/src/components/site-footer.test.jsx:91-106`:
```javascript
  it("ensures site-footer.css does NOT contain any hardcoded hex, rgb, or hsl colors", () => {
    const cssPath = path.resolve(__dirname, "./site-footer.css");
    const css = fs.readFileSync(cssPath, "utf8");

    // Check for hardcoded hex colors (#fff, #123456, etc.)
    const hexMatches = css.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(hexMatches).toBeNull();

    // Check for rgb or rgba colors
    const rgbMatches = css.match(/rgba?\([^)]+\)/g);
    expect(rgbMatches).toBeNull();

    // Check for hsl or hsla colors
    const hslMatches = css.match(/hsla?\([^)]+\)/g);
    expect(hslMatches).toBeNull();
  });
```

Repo conventions:
- Design tokens are provided via CSS custom properties (`var(--card-border)`, `var(--card-bg)`, `var(--text)`, `var(--primary)`) or `color-mix(in srgb, ...)` per Scandinavian taste guidelines.
- Exemplar usage in `web/src/components/site-footer.css:65`:
  `box-shadow: 0 4px 14px color-mix(in srgb, var(--text) 8%, transparent);`

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Web test suite | `npm run test:web` | exit 0, all 29 test files pass |
| Footer test only | `npm run test:web -- site-footer.test.jsx` | exit 0, 7 passed |
| Web lint | `npm run lint --workspace=web` | exit 0 |
| All monorepo tests | `npm run test` | exit 0 across server, web, mobile |

## Scope

**In scope**:
- `web/src/components/site-footer.css`

**Out of scope**:
- `web/src/components/site-footer.test.jsx` — do NOT relax or delete the color token test assertions.
- Any other styling or markup changes in `web/src/components/site-footer.jsx`.

## Git workflow

- Branch: `advisor/015-fix-site-footer-rgb-tokens`
- Commit style: `fix(web): replace hardcoded rgb fallbacks in site footer with color tokens`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Replace hardcoded RGB fallbacks in site-footer.css

Open `web/src/components/site-footer.css`:
1. In `.site-footer-util-item:hover` (around line 240-241), replace:
   ```css
   border-color: var(--card-border-strong, rgb(0 0 0 / 18%));
   background: var(--hover-fill, rgb(0 0 0 / 5%));
   ```
   with:
   ```css
   border-color: var(--card-border-strong, color-mix(in srgb, var(--text) 18%, transparent));
   background: var(--hover-fill, color-mix(in srgb, var(--text) 5%, transparent));
   ```
2. In `.site-footer-social-link:hover` (around line 310-311), replace:
   ```css
   border-color: var(--card-border-strong, rgb(0 0 0 / 18%));
   background: var(--hover-fill, rgb(0 0 0 / 5%));
   ```
   with:
   ```css
   border-color: var(--card-border-strong, color-mix(in srgb, var(--text) 18%, transparent));
   background: var(--hover-fill, color-mix(in srgb, var(--text) 5%, transparent));
   ```

**Verify**: `npm run test:web -- site-footer.test.jsx` → 7 passed, exit 0.

### Step 2: Verify full monorepo test suite

Run the full monorepo test command to ensure the entire test suite passes without errors.

**Verify**: `npm run test` → exit 0 across `server`, `web`, and `mobile`.

## Test plan

- Existing test `web/src/components/site-footer.test.jsx` asserts that `site-footer.css` contains no hex, rgb, or hsl values.
- Verification: `npm run test:web -- site-footer.test.jsx` passes all 7 tests.

## Done criteria

- [ ] `web/src/components/site-footer.css` contains no `rgb(` or `rgba(` patterns (`grep -E "rgba?\(" web/src/components/site-footer.css` returns empty)
- [ ] `npm run test:web -- site-footer.test.jsx` exits 0
- [ ] `npm run test:web` exits 0 across all 29 test files
- [ ] `npm run test` exits 0 across all 3 monorepo workspaces
- [ ] No files outside `web/src/components/site-footer.css` are modified

## STOP conditions

- The test in `site-footer.test.jsx` fails on any remaining rgb/hex/hsl pattern after the change.
- A change outside `web/src/components/site-footer.css` appears necessary.

## Maintenance notes

- Any future styling updates to `site-footer.css` must use `var(--custom-property)` or `color-mix(in srgb, ...)` to satisfy the strict zero-literal-color test.
