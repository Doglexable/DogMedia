import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAccess } from "../access-context";
import { GlobalPlayerProvider } from "./GlobalPlayer";
import { LibraryShell } from "./library-shell";
import { lazyWithRetry } from "../utils/lazy-with-retry";

const Dashboard = lazyWithRetry(() => import("../pages/Dashboard"));
const Player = lazyWithRetry(() => import("../pages/Player"));
const Wrapped = lazyWithRetry(() => import("../pages/Wrapped"));
const Admin = lazyWithRetry(() => import("../pages/Admin"));
const MasterUsers = lazyWithRetry(() => import("../pages/MasterUsers"));
const RequestMedia = lazyWithRetry(() => import("../pages/RequestMedia"));
const AndroidUpload = lazyWithRetry(() => import("../pages/AndroidUpload"));

export default function ProtectedApp() {
  const access = useAccess();

  return (
    <LibraryShell access={access}>
      <GlobalPlayerProvider>
        <Suspense fallback={<div className="premium-app-shell min-h-screen" style={{ minHeight: "100vh", background: "var(--bg)" }} />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/media/:id" element={<Player />} />
            <Route path="/wrapped" element={<Wrapped />} />
            <Route path="/admin" element={<Navigate to="/admin/media" replace />} />
            <Route path="/admin/media" element={<Admin />} />
            <Route path="/admin/users" element={<MasterUsers />} />
            <Route path="/request-media" element={<RequestMedia />} />
            <Route path="/admin/android-upload" element={<AndroidUpload />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </GlobalPlayerProvider>
    </LibraryShell>
  );
}
