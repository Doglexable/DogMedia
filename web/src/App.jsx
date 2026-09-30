import { useEffect, useState, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { api } from "./api";
import { AccessContext } from "./access-context";
import { lazyWithRetry } from "./utils/lazy-with-retry";
import { APP_VERSION_LABEL } from "./version";

const AccessDenied = lazyWithRetry(() => import("./pages/AccessDenied"));
const SharedLikedMusic = lazyWithRetry(() => import("./pages/SharedLikedMusic"));
const SharedMusic = lazyWithRetry(() => import("./pages/SharedMusic"));
const ProtectedApp = lazyWithRetry(() => import("./components/protected-app"));

function AccessGuard({ children }) {
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    api("/api/check-access")
      .then((res) => {
        if (!res.ok) throw new Error("Forbidden");
        return res.json();
      })
      .then((data) =>
        setStatus({ ok: true, tier: data.tier, description: data.description, firstRun: data.firstRun, clientIp: data.ip })
      )
      .catch(() => setStatus({ ok: false }));
  }, []);

  if (status === "loading") return (
    <div className="premium-app-shell grid min-h-screen place-items-center text-content" role="status" aria-label="Checking access">
      <div className="text-center">
        <div className="mx-auto h-11 w-11 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-muted">Opening private library</p>
        <span className="mt-2 inline-block rounded-full border border-primary/28 bg-primary/10 px-2.5 py-0.5 text-[11px] font-mono font-bold tracking-wide text-primary shadow-[0_2px_10px_rgba(225,29,72,0.12)]">
          {APP_VERSION_LABEL}
        </span>
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

export default function App() {
  useEffect(() => {
    const handleContextMenu = (event) => {
      if (event.target.closest("input, textarea, [contenteditable='true']")) {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/shared/likes/:token" element={<SharedLikedMusic />} />
          <Route path="/shared/music" element={<SharedMusic />} />
          <Route path="*" element={<AccessGuard><ProtectedApp /></AccessGuard>} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
