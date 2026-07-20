import { createContext, useCallback, useContext, useEffect, useState, useRef, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { api, getLocalIp, setClientIp } from "./api";
import { GlobalPlayerProvider } from "./components/GlobalPlayer";
import { LibraryShell } from "./components/library-shell";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Player = lazy(() => import("./pages/Player"));
const Wrapped = lazy(() => import("./pages/Wrapped"));
const Admin = lazy(() => import("./pages/Admin"));
const AccessDenied = lazy(() => import("./pages/AccessDenied"));
const SharedLikedMusic = lazy(() => import("./pages/SharedLikedMusic"));

const AccessContext = createContext(null);
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

export function useAccess() {
  return useContext(AccessContext);
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

function AccessGuard({ children }) {
  const [status, setStatus] = useState("loading");
  const ipRef = useRef(null);

  useEffect(() => {
    getLocalIp().then((ip) => {
      if (ip) {
        setClientIp(ip);
        ipRef.current = ip;
      }
      return api("/api/check-access").then((res) => {
        if (!res.ok) throw new Error("Forbidden");
        return res.json();
      });
    })
      .then((data) =>
        setStatus({ ok: true, tier: data.tier, description: data.description, firstRun: data.firstRun, clientIp: ipRef.current })
      )
      .catch(() => setStatus({ ok: false }));
  }, []);

  if (status === "loading") return (
    <div className="premium-app-shell grid min-h-screen place-items-center text-content" role="status" aria-label="Checking access">
      <div className="text-center">
        <div className="mx-auto h-11 w-11 animate-spin rounded-full border-2 border-card-border border-t-primary" />
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-muted">Opening private library</p>
      </div>
    </div>
  );
  if (!status.ok) return (
    <Suspense fallback={null}>
      <AccessDenied />
    </Suspense>
  );

  return (
    <AccessContext.Provider value={status}>
      {children}
    </AccessContext.Provider>
  );
}

function ProtectedRoutes() {
  const { tier } = useAccess();

  return (
    <LibraryShell tier={tier}>
      <GlobalPlayerProvider>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/media/:id" element={<Player />} />
            <Route path="/wrapped" element={<Wrapped />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </GlobalPlayerProvider>
    </LibraryShell>
  );
}

function ProtectedApp() {
  return (
    <AccessGuard>
      <ProtectedRoutes />
    </AccessGuard>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/shared/likes/:token" element={<SharedLikedMusic />} />
          <Route path="*" element={<ProtectedApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
