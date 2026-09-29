import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { Colors, Typography, Spacings, BorderRadiuses } from "react-native-ui-lib";

export const THEME_MODES = ["system", "light", "dark"];
const THEME_STORAGE_KEY = "theme";

export const palettes = {
  light: {
    bg: "#f8f8f7",
    surface: "#ffffff",
    surfaceSoft: "rgba(0, 0, 0, 0.04)",
    card: "#ffffff",
    cardBorder: "rgba(0, 0, 0, 0.10)",
    cardBorderStrong: "rgba(0, 0, 0, 0.18)",
    cardSoft: "rgba(0, 0, 0, 0.05)",
    text: "#0a0a0a",
    muted: "rgba(0, 0, 0, 0.54)",
    inkSecondary: "rgba(0, 0, 0, 0.64)",
    inkTertiary: "rgba(0, 0, 0, 0.46)",
    subtle: "rgba(0, 0, 0, 0.38)",
    primary: "#e11d48",
    hoverFill: "rgba(0, 0, 0, 0.05)",
    pressedFill: "rgba(0, 0, 0, 0.09)",
    warningBg: "#fff9e6",
    warningText: "#7a5e00",
    warningBorder: "#e8c600",
    successBg: "#edf7f0",
    successText: "#155724",
    successBorder: "rgba(0, 0, 0, 0.10)",
    danger: "#ef4444",
    white: "#ffffff",
    black: "#000000",
  },
  dark: {
    bg: "#0a0a0a",
    surface: "#1c1c1c",
    surfaceSoft: "rgba(255, 255, 255, 0.05)",
    card: "#181818",
    cardBorder: "rgba(255, 255, 255, 0.11)",
    cardBorderStrong: "rgba(255, 255, 255, 0.18)",
    cardSoft: "rgba(255, 255, 255, 0.07)",
    text: "#f5f5f4",
    muted: "rgba(255, 255, 255, 0.50)",
    inkSecondary: "rgba(255, 255, 255, 0.56)",
    inkTertiary: "rgba(255, 255, 255, 0.36)",
    subtle: "rgba(255, 255, 255, 0.35)",
    primary: "#e11d48",
    hoverFill: "rgba(255, 255, 255, 0.09)",
    pressedFill: "rgba(255, 255, 255, 0.14)",
    warningBg: "#3d2e00",
    warningText: "#ffc107",
    warningBorder: "#664d00",
    successBg: "#1e3a2f",
    successText: "#5cd487",
    successBorder: "#2d6a4f",
    danger: "#ef4444",
    white: "#ffffff",
    black: "#000000",
  },
};

export const colors = palettes.dark;

// Initialize react-native-ui-lib foundation tokens
try {
  Colors.loadSchemes({
    light: {
      screenBG: palettes.light.bg,
      textColor: palettes.light.text,
      cardBG: palettes.light.card,
      primaryColor: palettes.light.primary,
      ...palettes.light,
    },
    dark: {
      screenBG: palettes.dark.bg,
      textColor: palettes.dark.text,
      cardBG: palettes.dark.card,
      primaryColor: palettes.dark.primary,
      ...palettes.dark,
    },
  });

  Typography.loadTypographies({
    spotifyDisplay: { fontSize: 32, fontWeight: "900", letterSpacing: -0.5 },
    spotifyHeading: { fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
    spotifySection: { fontSize: 20, fontWeight: "800" },
    spotifyTitle: { fontSize: 16, fontWeight: "700" },
    spotifyBody: { fontSize: 14, fontWeight: "500" },
    spotifyCaption: { fontSize: 12, fontWeight: "600" },
    spotifyMeta: { fontSize: 11, fontWeight: "700" },
  });
} catch {
  // Non-fatal if runtime bundler initializes asynchronously
}

export const shadows = {
  light: {
    soft: {
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    floating: {
      shadowColor: "#000",
      shadowOpacity: 0.10,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 4,
    },
    dragging: {
      shadowColor: "#000",
      shadowOpacity: 0.14,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    story: {
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
  },
  dark: {
    soft: {
      shadowColor: "#000",
      shadowOpacity: 0.28,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 },
      elevation: 4,
    },
    floating: {
      shadowColor: "#000",
      shadowOpacity: 0.38,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
      elevation: 8,
    },
    dragging: {
      shadowColor: "#000",
      shadowOpacity: 0.44,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 10,
    },
    story: {
      shadowColor: "#000",
      shadowOpacity: 0.40,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
  },
};

export function alpha(color, opacity) {
  if (typeof color === "string" && color.startsWith("rgba(")) {
    return color.replace(/,[\s\d.]+\)$/, `, ${opacity})`);
  }
  if (typeof color === "string" && color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${opacity})`);
  }
  const value = String(color || "").replace("#", "");
  if (value.length !== 6) return `rgba(255,255,255,${opacity})`;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

const ThemeContext = createContext({
  colors,
  shadow: shadows.dark,
  mode: "system",
  resolvedMode: "dark",
  setMode: () => {},
  toggleMode: () => {},
});

function normalizeThemeMode(mode) {
  return THEME_MODES.includes(mode) ? mode : "system";
}

function resolveThemeMode(mode, systemScheme) {
  if (mode === "system") return systemScheme === "light" ? "light" : "dark";
  return mode;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState("system");

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled) setModeState(normalizeThemeMode(stored));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const setMode = useCallback((nextMode) => {
    const normalized = normalizeThemeMode(nextMode);
    setModeState(normalized);
    AsyncStorage.setItem(THEME_STORAGE_KEY, normalized).catch(() => {});
  }, []);

  const toggleMode = useCallback(() => {
    setMode(THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length]);
  }, [mode, setMode]);

  const resolvedMode = resolveThemeMode(mode, systemScheme);

  useEffect(() => {
    try {
      Colors.setScheme(resolvedMode);
    } catch {
      // Non-fatal
    }
  }, [resolvedMode]);

  const value = useMemo(() => ({
    colors: palettes[resolvedMode],
    shadow: shadows[resolvedMode],
    mode,
    resolvedMode,
    setMode,
    toggleMode,
  }), [mode, resolvedMode, setMode, toggleMode]);

  return createElement(ThemeContext.Provider, { value }, children);
}

export function ThemeToggle() {
  return null;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  full: 9999,
};

try {
  Spacings.loadSpacings(spacing);
  BorderRadiuses.loadBorderRadiuses(radii);
} catch {
  // Non-fatal
}
