import { useEffect, useState, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { api } from "./api";
import { AccessContext } from "./access-context";

const AccessDenied = lazy(() => import("./pages/AccessDenied"));
const SharedLikedMusic = lazy(() => import("./pages/SharedLikedMusic"));
const ProtectedApp = lazy(() => import("./components/protected-app"));

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
          <Route path="*" element={<AccessGuard><ProtectedApp /></AccessGuard>} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
