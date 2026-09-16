import { describe, expect, it } from "vitest";
import { VAULT_COLORS, VAULT_PALETTE, VAULT_THEME } from "./vault-palette";

describe("vault-palette", () => {
  it("exports core brand colors", () => {
    expect(VAULT_COLORS.ink).toBe("#101116");
    expect(VAULT_COLORS.paper).toBe("#f5f4f1");
    expect(VAULT_COLORS.rose).toBe("#e11d48");
    expect(VAULT_COLORS.white).toBe("#ffffff");
    expect(VAULT_COLORS.playbackSignal).toBe("#e11d48");
  });

  it("exports light and dark themes", () => {
    expect(VAULT_THEME.light.bg).toBe("#f5f4f1");
    expect(VAULT_THEME.light.text).toBe("#101116");
    expect(VAULT_THEME.light.primary).toBe("#e11d48");

    expect(VAULT_THEME.dark.bg).toBe("#101116");
    expect(VAULT_THEME.dark.text).toBe("#f4f3f0");
    expect(VAULT_THEME.dark.primary).toBe("#e11d48");
  });

  it("exports default VAULT_PALETTE bundle", () => {
    expect(VAULT_PALETTE.colors).toEqual(VAULT_COLORS);
    expect(VAULT_PALETTE.theme).toEqual(VAULT_THEME);
  });
});
