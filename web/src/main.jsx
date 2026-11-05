import "./theme.css";
import "./vault-theme.css";
import "./components/collection-flight.css";
import "@fontsource-variable/inter";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { isChunkLoadError, reloadForChunkError } from "./utils/lazy-with-retry";

// Catch stale chunk errors emitted by Vite when a new deployment replaces hashed chunks
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForChunkError(event.payload)) event?.preventDefault?.();
});

window.addEventListener("unhandledrejection", (event) => {
  if (isChunkLoadError(event.reason)) {
    if (reloadForChunkError(event.reason)) event?.preventDefault?.();
  }
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            registration.update().catch(() => {});
          }
        });
        registration.update().catch(() => {});
      })
      .catch(() => {});
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
