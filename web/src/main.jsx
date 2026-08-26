import "./theme.css";
import "./vault-theme.css";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/latin-500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

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
