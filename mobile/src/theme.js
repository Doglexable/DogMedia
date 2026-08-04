import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";

export const THEME_MODES = ["system", "light", "dark"];
const THEME_STORAGE_KEY = "theme";

export const palettes = {
  light: {
    bg: "#f4f4f7",
    surface: "#ffffff",
    card: "rgba(255,255,255,0.92)",
    cardSoft: "rgba(24,24,27,0.07)",
    text: "#18181b",
    muted: "#71717a",
    subtle: "#a1a1aa",
    primary: "#e11d48",
    warningBg: "#fff3cd",
    warningText: "#856404",
    warningBorder: "#ffc107",
    successBg: "#d4edda",
    successText: "#155724",
    successBorder: "#c3e6cb",
    danger: "#ef4444",
    white: "#ffffff",
    black: "#000000",
  },
  dark: {
    bg: "#09090b",
    surface: "#121218",
    card: "rgba(24,24,27,0.92)",
    cardSoft: "rgba(255,255,255,0.07)",
    text: "#f4f4f5",
    muted: "#a1a1aa",
    subtle: "#6b7280",
    primary: "#3b82f6",
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

export function alpha(hex, opacity) {
  const value = String(hex || "").replace("#", "");
  if (value.length !== 6) return `rgba(255,255,255,${opacity})`;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

const ThemeContext = createContext({
  colors,
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
  const value = useMemo(() => ({
    colors: palettes[resolvedMode],
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
  lg: 16,
  xl: 22,
};

export const shadow = {
  soft: {
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
};
