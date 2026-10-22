import { useEffect, useState, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { api } from "./api";
import { AccessContext } from "./access-context";
import { ConnectionError } from "./components/app-error-boundary";
import { lazyWithRetry } from "./utils/lazy-with-retry";
import { APP_VERSION_LABEL } from "./version";

const SharedLikedMusic = lazyWithRetry(() => import("./pages/SharedLikedMusic"));
const SharedMusic = lazyWithRetry(() => import("./pages/SharedMusic"));
const ProtectedApp = lazyWithRetry(() => import("./components/protected-app"));

function AccessGuard({ children }) {
  const [status, setStatus] = useState("loading");
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const requireLogin = () => setStatus({ ok: false });
    window.addEventListener("dogmedia:login-required", requireLogin);
    api("/api/check-access").then(async (res) => {
      if (res.status === 401) return { ok: false };
      if (!res.ok) throw new Error("Server unavailable");
      return { ok: true, ...await res.json() };
    }).then(setStatus).catch(() => setStatus({ ok: false, offline: true }));
    return () => window.removeEventListener("dogmedia:login-required", requireLogin);
  }, []);

  if (status === "loading") return (
    <div className="premium-app-shell grid min-h-screen place-items-center text-content" role="status" aria-label="Checking access">
      <div className="text-center">
        <div className="mx-auto h-11 w-11 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-muted">Opening private library</p>
        <span className="mt-2 inline-block rounded-full border border-primary/28 bg-primary/10 px-2.5 py-0.5 text-[11px] font-mono font-bold tracking-wide text-primary">{APP_VERSION_LABEL}</span>
      </div>
    </div>
  );
  if (status.offline) return <ConnectionError offline />;
  if (!status.ok) return (
    <div className="premium-app-shell grid min-h-screen place-items-center bg-background px-4 text-content">
      <form className="w-full max-w-sm rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl" onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        setSubmitting(true);
        try {
          const response = await api(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
          const data = await response.json().catch(() => null);
          if (!response.ok) throw new Error(data?.error || "Authentication failed");
          setPassword("");
          setStatus({ ok: true, tier: data.user.tier, username: data.user.username, description: data.user.username, id: data.user.id });
        } catch (failure) { setError(failure.message); }
        finally { setSubmitting(false); }
      }}>
        <h1 className="text-xl font-bold">{mode === "login" ? "Log in to Dogmedia" : "Create account"}</h1>
        <p className="mt-2 text-sm text-muted">Your private media library</p>
        <label className="mt-6 block text-sm font-semibold" htmlFor="account-username">Username</label>
        <input id="account-username" autoComplete="username" required minLength={3} maxLength={40} value={username} onChange={(event) => setUsername(event.target.value)} className="mt-2 w-full rounded-lg border border-white/20 bg-transparent px-3 py-2 text-content" />
        <label className="mt-4 block text-sm font-semibold" htmlFor="account-password">Password</label>
        <input id="account-password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 12 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-white/20 bg-transparent px-3 py-2 text-content" />
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={submitting} className="mt-5 w-full rounded-lg bg-primary px-4 py-2 font-semibold text-white">{mode === "login" ? "Log in" : "Create account"}</button>
        <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} className="mt-4 block text-sm text-primary">{mode === "login" ? "Create an account" : "Already have an account? Log in"}</button>
      </form>
    </div>
  );

  return <AccessContext.Provider value={{ ...status, logout: async () => {
    await api("/api/auth/logout", { method: "POST" });
    setStatus({ ok: false });
  }, updateUser: (user) => {
    setStatus((prev) => ({ ...prev, ...user, username: user?.username || prev.username, description: user?.username || prev.description }));
  } }}>{children}</AccessContext.Provider>;
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
