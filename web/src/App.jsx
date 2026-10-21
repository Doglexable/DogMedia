import { useEffect, useState, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { api } from "./api";
import { AccessContext } from "./access-context";
import { ConnectionError } from "./components/app-error-boundary";
import { lazyWithRetry } from "./utils/lazy-with-retry";
import { APP_VERSION_LABEL } from "./version";

const AccessDenied = lazyWithRetry(() => import("./pages/AccessDenied"));
const SharedLikedMusic = lazyWithRetry(() => import("./pages/SharedLikedMusic"));
const SharedMusic = lazyWithRetry(() => import("./pages/SharedMusic"));
const ProtectedApp = lazyWithRetry(() => import("./components/protected-app"));

function AccessGuard({ children }) {
  const [status, setStatus] = useState("loading");
  const [accessKey, setAccessKey] = useState("");
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    const requireLogin = () => setStatus((current) => current?.ok ? { ...current, mediaLoginRequired: true } : current);
    window.addEventListener("dogmedia:media-access-required", requireLogin);
    return () => window.removeEventListener("dogmedia:media-access-required", requireLogin);
  }, []);

  useEffect(() => {
    api("/api/check-access")
      .then((res) => {
        if (!res.ok) throw new Error("Forbidden");
        return res.json();
      })
      .then(async (data) => {
        const mediaStatus = await api("/api/media-access/status");
        setStatus({ ok: true, tier: data.tier, description: data.description, firstRun: data.firstRun, clientIp: data.ip, mediaLoginRequired: mediaStatus.status === 401 });
      })
      .catch((error) => setStatus({ ok: false, offline: error instanceof TypeError || navigator.onLine === false }));
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
  if (status.offline) return <ConnectionError offline />;
  if (!status.ok) return (
    <Suspense fallback={null}>
      <AccessDenied />
    </Suspense>
  );
  if (status.mediaLoginRequired) return (
    <div className="premium-app-shell grid min-h-screen place-items-center bg-background px-4 text-content">
      <form className="w-full max-w-sm rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl" onSubmit={async (event) => {
        event.preventDefault();
        setLoginError("");
        try {
          const response = await api("/api/media-access/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: accessKey }) });
          if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Access denied");
          setAccessKey("");
          setStatus((current) => ({ ...current, mediaLoginRequired: false }));
        } catch (error) {
          setLoginError(error.message);
        }
      }}>
        <h1 className="text-xl font-bold">Unlock media library</h1>
        <p className="mt-2 text-sm text-muted">Enter the access key configured on the server.</p>
        <label className="mt-6 block text-sm font-semibold" htmlFor="media-access-key">Access key</label>
        <input id="media-access-key" type="password" autoComplete="current-password" required value={accessKey} onChange={(event) => setAccessKey(event.target.value)} className="mt-2 w-full rounded-lg border border-white/20 bg-transparent px-3 py-2 text-content" />
        {loginError && <p role="alert" className="mt-3 text-sm text-red-400">{loginError}</p>}
        <button type="submit" className="mt-5 w-full rounded-lg bg-primary px-4 py-2 font-semibold text-white">Unlock</button>
      </form>
    </div>
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
