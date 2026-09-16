/**
 * DogMedia Vault Color Palette & Tokens
 *
 * Core brand colors, atomic tokens, and semantic light/dark theme values.
 */

export const VAULT_COLORS = {
  ink: "#101116",
  paper: "#f5f4f1",
  rose: "#e11d48",
  white: "#ffffff",
  playbackSignal: "#e11d48",
};

export const VAULT_THEME = {
  light: {
    bg: "#f5f4f1",
    text: "#101116",
    primary: "#e11d48",
    muted: "#696d77",
    surfaceSolid: "#ffffff",
    surfaceSoft: "rgba(255, 255, 255, 0.5)",
    cardBg: "rgba(255, 255, 255, 0.78)",
    cardBorder: "rgba(16, 17, 22, 0.12)",
    shadowSoft: "0 18px 48px rgba(28, 28, 36, 0.08)",
    shadowLift: "0 28px 70px rgba(24, 24, 30, 0.14)",
  },
  dark: {
    bg: "#101116",
    text: "#f4f3f0",
    primary: "#e11d48",
    muted: "#a1a3ad",
    surfaceSolid: "#1b1c22",
    surfaceSoft: "rgba(26, 27, 33, 0.64)",
    cardBg: "rgba(29, 30, 37, 0.82)",
    cardBorder: "rgba(255, 255, 255, 0.11)",
    codeBg: "#16171c",
    codeBorder: "#30313a",
    tableBorder: "#34353d",
    tableBorderLight: "#282931",
    shadowSoft: "0 18px 48px rgba(0, 0, 0, 0.24)",
    shadowLift: "0 32px 76px rgba(0, 0, 0, 0.42)",
  },
};

export const VAULT_PALETTE = {
  colors: VAULT_COLORS,
  theme: VAULT_THEME,
};

export default VAULT_PALETTE;
