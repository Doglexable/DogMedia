import "./theme.css";
import "./vault-theme.css";
import "@fontsource-variable/inter";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isChunkLoadError, CHUNK_RELOAD_KEY } from "./utils/lazy-with-retry";

// Catch stale chunk errors emitted by Vite when a new deployment replaces hashed chunks
window.addEventListener("vite:preloadError", (event) => {
  event?.preventDefault?.();
  if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, "true");
    window.location.reload();
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (isChunkLoadError(event.reason)) {
    event?.preventDefault?.();
    if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, "true");
      window.location.reload();
    }
  }
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
