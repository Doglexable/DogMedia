import { useCallback, useEffect, useState } from "react";

const THEME_MODES = ["system", "light", "dark"];

function getStoredThemeMode() {
  const mode = localStorage.getItem("theme") || document.documentElement.dataset.themeMode || "system";
  return THEME_MODES.includes(mode) ? mode : "system";
}

function resolveThemeMode(mode) {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function applyThemeMode(mode) {
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolveThemeMode(mode);
  localStorage.setItem("theme", mode);
}

export function ThemeToggle({ style, className }) {
  const [mode, setMode] = useState(getStoredThemeMode);

  useEffect(() => {
    applyThemeMode(mode);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      if (getStoredThemeMode() === "system") {
        document.documentElement.dataset.theme = resolveThemeMode("system");
      }
    };

    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next = THEME_MODES[(THEME_MODES.indexOf(current) + 1) % THEME_MODES.length];
      applyThemeMode(next);
      return next;
    });
  }, []);

  return (
    <button
      type="button"
      className={className}
      style={style}
      onClick={toggle}
      title={`Theme: ${mode}`}
    >
      Theme: {mode[0].toUpperCase() + mode.slice(1)}
    </button>
  );
}
